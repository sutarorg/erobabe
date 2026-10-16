import "server-only";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v3.2";

export class FunnyUsernameError extends Error {
  constructor(message = "AI usernames are temporarily unavailable. Please try again shortly.") {
    super(message);
    this.name = "FunnyUsernameError";
  }
}

function usernameFromResponse(value: unknown): string {
  if (typeof value !== "string") throw new FunnyUsernameError();

  let candidate = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(candidate) as { username?: unknown };
    if (typeof parsed.username === "string") candidate = parsed.username;
  } catch {
    // The model is asked for plain text; tolerate a quoted or JSON-wrapped reply.
  }

  candidate = candidate
    .split(/\r?\n/, 1)[0]
    .replace(/^\s*(?:funny\s+)?username\s*:\s*/i, "")
    .replace(/^[\s"'`*_#>-]+|[\s"'`*_#]+$/g, "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N} '\u2019-]/gu, " ")
    .replace(/[’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  const words = candidate.split(" ");
  if (candidate.length < 4 || candidate.length > 44 || words.length < 2 || words.length > 4) {
    throw new FunnyUsernameError();
  }

  return candidate;
}

/**
 * Ask OpenRouter for the witty part of an anonymous handle. The caller adds a
 * random database-enforced suffix so separate visitors never share a name.
 */
export async function generateFunnyUsername(): Promise<string> {
  let key = String(process.env.OPENROUTER_API_KEY || "").trim();
  key = key.replace(/^OPENROUTER_API_KEY\s*=\s*/i, "").trim();
  key = key.replace(/^(["'`])([\s\S]*)\1$/, "$2").trim();
  if (!key || /\s/.test(key)) throw new FunnyUsernameError();

  const model = String(process.env.OPENROUTER_USERNAME_MODEL || process.env.OPENROUTER_MODEL || DEFAULT_MODEL).trim();
  let response: Response;
  try {
    response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "X-Title": "Erobabe anonymous comments",
      },
      body: JSON.stringify({
        model,
        temperature: 1.05,
        max_tokens: 48,
        messages: [
          {
            role: "system",
            content:
              "You invent playful, harmless, funny anonymous usernames. Return one username only, with no explanation. Use 2 to 4 English words. Keep it friendly and non-sexual; never use slurs, real-person names, age references, or personal information.",
          },
          {
            role: "user",
            content:
              "Invent a fresh, absurdly funny username using an unexpected animal, snack, object, or job. Maximum 44 characters. Do not copy examples or add digits, quotes, punctuation, or explanations.",
          },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new FunnyUsernameError();
  }

  if (!response.ok) throw new FunnyUsernameError();
  const payload = (await response.json().catch(() => null)) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  } | null;
  const username = usernameFromResponse(payload?.choices?.[0]?.message?.content);
  return username;
}
