/**
 * User-agent reduction for analytics collection.
 *
 * The raw string is never stored: only the coarse device class, browser family
 * and operating system are kept, which is all a traffic report needs and a lot
 * less identifying than the full header. Automated traffic (crawlers, uptime
 * checks, headless browsers, scripted clients) is recognised so it does not
 * pollute the visitor counts.
 */

export type ClientInfo = {
  device: "desktop" | "mobile" | "tablet" | "other";
  browser: string;
  os: string;
};

const MAX_FIELD = 40;

function clean(value: string): string {
  return value.slice(0, MAX_FIELD);
}

const BOT_PATTERN =
  /bot\b|bots\b|crawler|spider|slurp|googlebot|bingbot|yandex|baidu|duckduckbot|sogou|exabot|petalbot|ahrefs|semrush|mj12|dotbot|bytespider|facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterestbot|applebot|headlesschrome|phantomjs|selenium|puppeteer|playwright|lighthouse|pagespeed|gtmetrix|pingdom|uptime|statuscake|newrelic|curl\/|wget\/|python-requests|python-urllib|aiohttp|axios\/|node-fetch|go-http-client|okhttp|java\/|libwww|postman/i;

/** True when the traffic is a machine, not a person. */
export function isAutomatedUserAgent(userAgent: string | null | undefined): boolean {
  const ua = (userAgent || "").trim();
  // A browser always sends a user-agent; an empty one is a script or a probe.
  if (!ua) return true;
  return BOT_PATTERN.test(ua);
}

/** Device class, browser family and OS from a user-agent string. */
export function classifyUserAgent(userAgent: string | null | undefined): ClientInfo {
  const ua = (userAgent || "").trim();
  if (!ua) return { device: "other", browser: "Unknown", os: "Unknown" };

  const isTablet =
    /ipad|tablet|playbook|silk/i.test(ua) ||
    // Android without "Mobile" is the tablet form factor.
    (/android/i.test(ua) && !/mobile/i.test(ua));
  const isMobile =
    !isTablet &&
    /mobile|iphone|ipod|android|blackberry|bb10|opera mini|windows phone|iemobile|webos/i.test(ua);

  const device: ClientInfo["device"] = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "Other";
  if (/edg\//i.test(ua) || /edge\//i.test(ua)) browser = "Edge";
  else if (/opr\/|opera/i.test(ua)) browser = "Opera";
  else if (/samsungbrowser/i.test(ua)) browser = "Samsung Internet";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/crios|chrome|chromium/i.test(ua)) browser = "Chrome";
  else if (/safari/i.test(ua)) browser = "Safari";
  else if (/msie|trident/i.test(ua)) browser = "Internet Explorer";

  let os = "Other";
  if (/windows phone/i.test(ua)) os = "Windows Phone";
  else if (/windows/i.test(ua)) os = "Windows";
  else if (/android/i.test(ua)) os = "Android";
  else if (/iphone|ipad|ipod|ios/i.test(ua)) os = "iOS";
  else if (/cros/i.test(ua)) os = "ChromeOS";
  else if (/mac os x|macintosh/i.test(ua)) os = "macOS";
  else if (/linux/i.test(ua)) os = "Linux";

  return { device, browser: clean(browser), os: clean(os) };
}
