/**
 * Video hosting provider selection.
 *
 * UFOLOAD is the only active upload and hosting provider. `VIDEO_PROVIDER`
 * selects it; anything else FAILS CLOSED with an actionable configuration
 * error — in particular there is no fallback to Uqload (or to any other
 * provider) for an unknown or legacy value.
 *
 * Existing Uqload videos are not touched by this module: their rows keep
 * `provider = 'uqload'` and their stored `embed_url`, which the public watch
 * page renders like any other iframe source.
 */

import { VideoProviderConfigError } from "@/lib/video/errors";
import { UfoloadProvider, type UfoloadProviderOptions, type VideoProvider } from "@/lib/video/ufoload";

export { UfoloadProvider } from "@/lib/video/ufoload";
export type {
  CompletedUpload,
  DirectUploadGrant,
  DirectUploadStatus,
  ImportTask,
  ProviderFile,
  UfoloadProviderOptions,
  VideoProvider,
} from "@/lib/video/ufoload";

/** The provider names this build can run. Everything else is rejected. */
export const SUPPORTED_VIDEO_PROVIDERS = ["ufoload"] as const;

/** Echoes a configured value in an error message without letting a pasted secret through. */
function printable(value: string): string {
  const cleaned = value.replace(/ufo_[A-Za-z0-9_-]{6,}/g, "[redacted]").replace(/[^A-Za-z0-9_.\- [\]]/g, "?");
  return cleaned.length > 40 ? `${cleaned.slice(0, 37)}…` : cleaned;
}

/**
 * Returns the configured provider, or throws {@link VideoProviderConfigError}.
 *
 * `name` defaults to `process.env.VIDEO_PROVIDER`; an unset/blank value means
 * the default, `ufoload` (it still needs `UFOLOAD_API_KEY` and
 * `UFOLOAD_ADULT_CONTENT_APPROVED=true` before it will do anything).
 */
export function getVideoProvider(
  name: string | undefined | null = process.env.VIDEO_PROVIDER,
  options: UfoloadProviderOptions = {}
): VideoProvider {
  const requested = String(name ?? "").trim().toLowerCase();

  if (requested === "" || requested === "ufoload") return new UfoloadProvider(options);

  if (requested === "uqload") {
    throw new VideoProviderConfigError(
      "provider_legacy_unsupported",
      "VIDEO_PROVIDER=uqload is no longer supported.",
      "Uqload has been replaced by UFOLOAD. Set VIDEO_PROVIDER=ufoload (and UFOLOAD_API_KEY / UFOLOAD_ADULT_CONTENT_APPROVED) in the server environment. Existing Uqload videos keep playing; no new upload is ever sent to Uqload."
    );
  }

  throw new VideoProviderConfigError(
    "provider_unknown",
    `Unknown VIDEO_PROVIDER "${printable(requested)}".`,
    `The only supported video provider is "ufoload". Set VIDEO_PROVIDER=ufoload in the server environment. The app never falls back to another provider.`
  );
}
