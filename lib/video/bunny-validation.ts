import { z } from "zod";

export type UploadPolicy = {
  mimeTypes: string[];
  maxBytes: number;
  concurrency: number;
  headers: Record<string, string>;
  visionRanking?: boolean;
};
export const sessionInput = z
  .object({
    sessionId: z.string().uuid(),
    title: z.string().trim().min(1).max(240),
    originalName: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine((v) => !/[\x00-\x1f/\\]/.test(v), "Invalid filename"),
    mimeType: z.string().max(100),
    sizeBytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    durationSeconds: z.number().int().nonnegative().max(2147483647).optional(),
    categoryId: z.string().uuid(),
  })
  .strict();
export function validateVideo(
  file: { type: string; size: number },
  policy: UploadPolicy,
): string | null {
  if (!policy.mimeTypes.includes(file.type))
    return "Unsupported video type. Choose one of the configured accepted formats.";
  if (!Number.isSafeInteger(file.size) || file.size <= 0)
    return "The video file is empty or has an invalid size.";
  if (file.size > policy.maxBytes)
    return `Video exceeds the configured ${Math.round(policy.maxBytes / 1024 / 1024)} MB limit.`;
  return null;
}
