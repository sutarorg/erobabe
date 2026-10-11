/**
 * Shared Uqload upload-response parser.
 * Safe to import from the browser — no API key, no Node-only APIs.
 */

function isProviderSuccess(status: unknown): boolean {
  return status === 200 || status === "200";
}

export function parseUqloadUploadResponse(text: string): { filecode: string; filename?: string } {
  const trimmed = String(text || "").trim();
  if (!trimmed) throw new Error("Uqload returned an empty upload response");

  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch {
    throw new Error("Uqload returned an invalid upload response");
  }

  const uploaded = Array.isArray(json?.files) ? json.files[0] : json?.files;
  const filecode =
    uploaded?.filecode ||
    uploaded?.file_code ||
    json?.result?.filecode ||
    json?.result?.file_code ||
    json?.filecode ||
    json?.file_code;

  if (!isProviderSuccess(json.status) || !filecode) {
    throw new Error(`Uqload file upload failed${json?.msg ? `: ${json.msg}` : ""}`);
  }

  return {
    filecode: String(filecode),
    filename: typeof uploaded?.filename === "string" ? uploaded.filename : undefined,
  };
}
