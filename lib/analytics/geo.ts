/**
 * Coarse geography for the audience report.
 *
 * Vercel resolves the visitor's country (and, for some plans, region and city)
 * at the edge and passes them as headers on the request. Nothing is looked up
 * from a third party and no coordinates are ever stored — the report only needs
 * "which country", "which region".
 */

export type Geo = { country: string | null; region: string | null; city: string | null };

const EMPTY: Geo = { country: null, region: null, city: null };

function text(value: string | null, max: number): string | null {
  if (!value) return null;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // The header is not percent-encoded on every provider.
  }
  const cleaned = decoded.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return cleaned || null;
}

/**
 * Reads the geography headers a request arrived with.
 *
 * The country must be a two-letter code; anything else is dropped rather than
 * written into the report. Region and city are optional and clipped.
 */
export function readGeo(headers: Headers): Geo {
  // Validate the whole header: truncating "United States" to "Un" would look
  // like a country code.
  const rawCountry = (headers.get("x-vercel-ip-country") || "").trim();
  const country = /^[a-z]{2}$/i.test(rawCountry) ? rawCountry.toUpperCase() : null;
  return {
    country,
    region: text(headers.get("x-vercel-ip-country-region"), 80),
    city: text(headers.get("x-vercel-ip-city"), 80),
  };
}

let displayNames: Intl.DisplayNames | null | undefined;

/** `US` → `United States`, falling back to the code. */
export function countryLabel(code: string | null | undefined): string {
  if (!code) return "(not set)";
  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      displayNames = null;
    }
  }
  try {
    const name = displayNames?.of(code.toUpperCase());
    // `Intl` answers "Unknown Region" for a syntactically valid but unassigned
    // code; showing the code is more honest than showing that.
    if (!name || name === "Unknown Region") return code.toUpperCase();
    return name;
  } catch {
    return code.toUpperCase();
  }
}

export const GEO_EMPTY: Geo = EMPTY;
