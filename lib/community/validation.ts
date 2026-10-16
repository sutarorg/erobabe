export const MAX_COMMENT_LENGTH = 100;

const LINK_PATTERNS = [
  /https?:\/\//i,
  /ftp:\/\//i,
  /\bwww\.[a-z0-9-]+/i,
  /\b[a-z0-9-]+\.(com|org|net|edu|gov|io|co|xyz|site|online|app|dev|me|info|tv|ai|top|club|vip|live|pro|is|to|cc|gg|link|biz|tech|store|shop|ly)\b/i,
];

/** Check if text contains any web links or URLs. */
export function containsLink(text: string): boolean {
  return LINK_PATTERNS.some((pattern) => pattern.test(text));
}
