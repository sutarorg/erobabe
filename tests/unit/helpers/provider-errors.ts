import { StreamtapeError } from "@/lib/video/streamtape-protocol";

/**
 * Awaits a call that must be rejected and returns the thrown provider error.
 *
 * Written as a helper because `promise.catch((error) => error)` widens the
 * result to `T | StreamtapeError`, which then has to be narrowed in every test.
 */
export async function rejected<T>(promise: Promise<T>): Promise<StreamtapeError> {
  try {
    await promise;
  } catch (error) {
    return error as StreamtapeError;
  }
  throw new Error("Expected the call to be rejected");
}
