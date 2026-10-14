import { z } from "zod";

export type UploadPolicy = {
  mimeTypes: string[];
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
    // Keep metadata representable in JavaScript/JSON without imposing an
    // application-level video-size policy.
    sizeBytes: z.number().int().positive().refine(Number.isSafeInteger),
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
  return null;
}
