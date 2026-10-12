import { UfoloadError } from "@/lib/video/ufoload-protocol";

/**
 * Awaits a call that must be rejected and returns the thrown provider error.
 *
 * Written as a helper because `promise.catch((error) => error)` widens the
 * result to `T | UfoloadError`, which then has to be narrowed in every test.
 */
export async function rejected<T>(promise: Promise<T>): Promise<UfoloadError> {
  try {
    await promise;
  } catch (error) {
    return error as UfoloadError;
  }
  throw new Error("Expected the call to be rejected");
}
