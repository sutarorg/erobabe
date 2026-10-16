import "server-only";
import { z } from "zod";
import {
  openRouterApiKey,
  OPENROUTER_ENDPOINT,
} from "@/lib/metadata/openrouter";
/** No default model, no automatic provider routing, no transmission without explicit consent. */
export function thumbnailVisionEnabled() {
  return (
    process.env.OPENROUTER_THUMBNAIL_ENABLED === "true" &&
    process.env.OPENROUTER_THUMBNAIL_CONTENT_APPROVED === "true" &&
    Boolean(
      process.env.OPENROUTER_THUMBNAIL_MODEL &&
      process.env.OPENROUTER_THUMBNAIL_PROVIDER &&
      openRouterApiKey(),
    )
  );
}
export const frameCandidates = z
  .array(
    z
      .string()
      .max(160000)
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/),
  )
  .min(2)
  .max(4);
/** null means use the deterministic local winner; never log frames or provider error bodies. */
export async function rankThumbnailCandidates(
  frames: string[],
): Promise<number | null> {
  if (!thumbnailVisionEnabled()) return null;
  const parsed = frameCandidates.safeParse(frames);
  if (!parsed.success) return null;
  try {
    const model = process.env.OPENROUTER_THUMBNAIL_MODEL!;
    const provider = process.env.OPENROUTER_THUMBNAIL_PROVIDER!;
    // Verify live input capabilities BEFORE sending any frame. No assumption about text metadata models.
    const catalogue = await fetch("https://openrouter.ai/api/v1/models", {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
      redirect: "error",
    });
    if (!catalogue.ok) return null;
    const models = await catalogue.json();
    if (
      !Array.isArray(models.data) ||
      !models.data.some(
        (m: { id?: string; architecture?: { input_modalities?: string[] } }) =>
          m.id === model && m.architecture?.input_modalities?.includes("image"),
      )
    )
      return null;
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey()}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(12000),
      redirect: "error",
      cache: "no-store",
      body: JSON.stringify({
        model,
        provider: {
          only: [provider],
          allow_fallbacks: false,
          data_collection: "deny",
        },
        temperature: 0,
        max_completion_tokens: 64,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Choose the best actual video thumbnail based on sharpness, exposure, clarity, colour balance and composition. Do not describe content. Return only JSON {"index":N}, zero-based index 0 to ${frames.length - 1}.`,
              },
              ...frames.map((url) => ({
                type: "image_url",
                image_url: { url },
              })),
            ],
          },
        ],
      }),
    });
    if (!response.ok) return null;
    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const winner = JSON.parse(content).index;
    return Number.isInteger(winner) && winner >= 0 && winner < frames.length
      ? winner
      : null;
  } catch {
    return null;
  }
}
