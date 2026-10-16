import "server-only";

import { randomInt } from "node:crypto";
import { FUNNY_WORDS } from "@/src/utils/funny-words";

export class FunnyUsernameError extends Error {
  constructor(message = "Unable to assign a username. Please try again shortly.") {
    super(message);
    this.name = "FunnyUsernameError";
  }
}

// Use the bundled library, not a remote service. Keep the word portion within
// the existing 44-character limit (the caller adds a database-unique suffix).
const USERNAME_WORDS = [...new Set(FUNNY_WORDS)]
  .filter((word) => /^[a-z]{3,20}$/i.test(word));

/** Generate a playful two-word handle locally, without API keys or network I/O. */
export function generateFunnyUsername(): string {
  const firstIndex = randomInt(USERNAME_WORDS.length);
  // Pick a different second word without an unbounded retry loop.
  const secondIndex = (firstIndex + 1 + randomInt(USERNAME_WORDS.length - 1)) % USERNAME_WORDS.length;
  const capitalize = (word: string) => word[0].toUpperCase() + word.slice(1);
  return `${capitalize(USERNAME_WORDS[firstIndex])} ${capitalize(USERNAME_WORDS[secondIndex])}`;
}
