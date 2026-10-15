/**
 * Title-voice policy for generated video metadata.
 *
 * Dependency-free and side-effect-free, so the same rules apply in the browser
 * (the upload queue validates its offline drafts) and on the server (the
 * OpenRouter client and the suggest route validate model replies). No key
 * material and no provider configuration live here.
 *
 * Two voices exist:
 *
 *  - `explicit` (the site default): titles written the way adult studios title
 *    real clips — plain, concrete sexual vocabulary naming the people, the act,
 *    the body parts and the place, e.g. "My Girlfriend Grabs My Cock For An
 *    Intense Raw Doggy Style Fuck In Our Apartment".
 *  - `editorial`: the older euphemistic magazine voice ("Amateur Cinema's
 *    Candid Boudoir Revelation"). Retained because an operator can set
 *    `VIDEO_TITLE_STYLE=editorial` and because restrained copy is still wanted
 *    for back-catalog regeneration.
 *
 * The voice only changes how blunt the wording is. The compliance floor below is
 * identical for both and is not configurable: no age-ambiguous wording, no
 * family-role/incest framing, nothing that implies coercion or filming without
 * consent. Those are legal and merchant-processor requirements for an
 * adults-only site (2257 records, DMCA posture, payment rules), not style
 * preferences, so no voice, environment variable or admin toggle relaxes them.
 */

export type TitleStyle = "explicit" | "editorial";

/**
 * Voice used when nothing is configured. `VIDEO_TITLE_STYLE` may switch the
 * whole install back to `editorial`; a single request may override the default.
 */
export const DEFAULT_TITLE_STYLE: TitleStyle = "explicit";

/** Case-insensitive, tolerant of `VIDEO_TITLE_STYLE=explicit` style values. */
export function normalizeTitleStyle(raw: unknown): TitleStyle | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (value === "explicit" || value === "porn" || value === "tube" || value === "hardcore") {
    return "explicit";
  }
  if (value === "editorial" || value === "safe" || value === "soft" || value === "magazine") {
    return "editorial";
  }
  return null;
}

/**
 * Server-side default from the environment. In a client bundle the inlined
 * lookup is simply absent, so the site default applies there too.
 */
export function resolveTitleStyle(raw: unknown = process.env.VIDEO_TITLE_STYLE): TitleStyle {
  return normalizeTitleStyle(raw) ?? DEFAULT_TITLE_STYLE;
}

/* ------------------------------------------------------------------------- */
/* Length and word budgets per voice                                          */
/* ------------------------------------------------------------------------- */

/**
 * A tube title is a sentence, not a headline: it needs room for subject, act
 * and place. `MAX_TITLE_LENGTH` (160) still caps what is stored, and the
 * session API accepts up to 240 characters, so the ceiling below is the
 * binding limit for generated copy.
 */
export const TITLE_WORD_BUDGET: Record<TitleStyle, { min: number; max: number }> = {
  explicit: { min: 6, max: 16 },
  editorial: { min: 4, max: 9 },
};

export const TITLE_CHAR_BUDGET: Record<TitleStyle, { min: number; max: number }> = {
  // The explicit voice is a sentence about a scene, so it has a real floor.
  explicit: { min: 35, max: 150 },
  // The editorial voice historically measured titles in words only, and its
  // 4-9 word headlines are routinely shorter than 35 characters, so the floor
  // here is only the "not a fragment" check `isValidTitle` already applies.
  editorial: { min: 8, max: 110 },
};

export function titleWordBudget(style: TitleStyle): { min: number; max: number } {
  return TITLE_WORD_BUDGET[style] || TITLE_WORD_BUDGET.explicit;
}

export function titleCharBudget(style: TitleStyle): { min: number; max: number } {
  return TITLE_CHAR_BUDGET[style] || TITLE_CHAR_BUDGET.explicit;
}

/* ------------------------------------------------------------------------- */
/* Vocabulary requirements                                                   */
/* ------------------------------------------------------------------------- */

/**
 * Word classes the explicit voice is expected to reach for. Used as a prompt
 * hint and as the "this title is blunt enough" test — it is a floor on style,
 * not a list of permitted words; nothing else about the title is constrained.
 */
export const EXPLICIT_ACT_WORDS = [
  "fuck",
  "fucks",
  "fucked",
  "fucking",
  "sex",
  "nipple",
  "orgasm",
  "cum",
  "cums",
  "cumming",
  "creampie",
  "blowjob",
  "handjob",
  "deepthroat",
  "facial",
  "squirt",
  "swallow",
  "ride",
  "rides",
  "straddle",
  "straddles",
  "grabs",
  "pound",
  "pounds",
  "thrust",
  "suck",
  "sucks",
  "lick",
  "licks",
  "spank",
  "spanks",
  "raw",
  "bareback",
  "rough",
  "hard",
] as const;

export const EXPLICIT_BODY_WORDS = [
  "cock",
  "dick",
  "shaft",
  "prick",
  "pussy",
  "clit",
  "ass",
  "asshole",
  "boobs",
  "tits",
  "boob",
  "boobjob",
  "slut",
  "whore",
  "fuckme",
] as const;

/**
 * Partner/role nouns that make a title concrete rather than abstract. These are
 * a prompt hint: naming who is in the scene is what separates a tube title from
 * an abstract one, but a subject noun alone never satisfies the requirement
 * above, which is why it is kept out of `REQUIRED_EXPLICIT_TERMS`.
 */
export const EXPLICIT_SUBJECT_WORDS = [
  "girlfriend",
  "boyfriend",
  "wife",
  "husband",
  "babes",
  "babe",
  "chick",
  "bitch",
  "amateur",
  "couple",
  "milf",
  "camgirl",
  "roommate",
  "ex",
  "her",
  "my",
  "she",
  "we",
] as const;

/**
 * At least one of these must appear in an explicit title: the words buyers
 * actually search for, and the ones that make a listing say what is on camera.
 * Deliberately restricted to acts and body parts — "girlfriend", "doggy style"
 * and "milf" describe who and how, not what, so a title built only from those
 * ("My Girlfriend Enjoys An Evening In Our Apartment") is treated as the
 * editorial voice leaking in and is rewritten offline instead of published.
 */
export const REQUIRED_EXPLICIT_TERMS = [
  "fuck",
  "fucks",
  "fucked",
  "fucking",
  "motherfucking",
  "sex",
  "cock",
  "cocks",
  "dick",
  "dicks",
  "penis",
  "pussy",
  "pussies",
  "cunt",
  "ass",
  "asses",
  "asshole",
  "tits",
  "tit",
  "boobs",
  "boob",
  "boobjob",
  "titjob",
  "clit",
  "clitoris",
  "nipple",
  "nipples",
  "topless",
  "nude",
  "naked",
  "cum",
  "cums",
  "cumming",
  "cumshot",
  "cumshots",
  "creampie",
  "creampies",
  "blowjob",
  "blowjobs",
  "handjob",
  "deepthroat",
  "facial",
  "facials",
  "slut",
  "sluts",
  "slutty",
  "whore",
  "whores",
  "gangbang",
  "orgy",
  "strapon",
  "anal",
  "bareback",
  "hardcore",
  "threesome",
  "sperm",
  "semen",
] as const;

function keywordPattern(words: readonly string[]): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${words.join("|")})(?:$|[^\\p{L}\\p{N}])`, "iu");
}

export const REQUIRED_EXPLICIT_PATTERN = keywordPattern(REQUIRED_EXPLICIT_TERMS);
const EXPLICIT_ACT_PATTERN = keywordPattern(EXPLICIT_ACT_WORDS);
const EXPLICIT_BODY_PATTERN = keywordPattern(EXPLICIT_BODY_WORDS);
const EXPLICIT_SUBJECT_PATTERN = keywordPattern(EXPLICIT_SUBJECT_WORDS);

/** True when the copy names at least one of the required sexual search terms. */
export function containsRequiredExplicitTerm(value: unknown): boolean {
  return REQUIRED_EXPLICIT_PATTERN.test(String(value ?? ""));
}

/** True when the copy uses any blunt sexual wording at all (act or body part). */
export function containsExplicitVocabulary(value: unknown): boolean {
  const text = String(value ?? "");
  return EXPLICIT_ACT_PATTERN.test(text) || EXPLICIT_BODY_PATTERN.test(text);
}

/** True when the copy names a person/role, which keeps a title concrete. */
export function containsExplicitSubject(value: unknown): boolean {
  return EXPLICIT_SUBJECT_PATTERN.test(String(value ?? ""));
}

/** Euphemistic magazine wording that must not survive in an explicit title. */
export const EDITORIAL_TELLS = [
  "cinema",
  "cinematic",
  "editorial",
  "boudoir revelation",
  "revelation",
  "art house",
  "art-house",
  "aesthetic",
  "soft focus",
  "velvet",
  "luminous",
  "tasteful",
  "evocative",
  "restrained",
  "meditation",
  "ode",
  "love letter",
  "programme note",
  "after dark",
] as const;

const EDITORIAL_TELL_PATTERN = keywordPattern(EDITORIAL_TELLS);

export function containsEditorialTell(value: unknown): boolean {
  return EDITORIAL_TELL_PATTERN.test(String(value ?? ""));
}

/* ------------------------------------------------------------------------- */
/* Compliance floor — identical for every voice                              */
/* ------------------------------------------------------------------------- */

/**
 * Age-ambiguous wording. Nothing in an adults-only listing may hint at youth:
 * this is the single highest-consequence filter in the pipeline, and it applies
 * to both voices, to the offline composer and to every model reply before that
 * reply can be stored.
 */
const AGE_AMBIGUOUS_COPY =
  /\b(?:underage|under[-\s]?age|minor(?:s)?|child(?:ren|like)?|kid(?:s)?|loli|shota|barely\s+legal|school(?:girl|boy|kid)?|classmate|student|preteen|adolescent|youth|young(?:er)?|teen(?:ager|age|aged)?|junior|fresh(?:man|men)|college\s+girl|teenage|girl(?:s)?|boy(?:s)?)\b/iu;

/** Anything that reads as a lone underage word, including inside compounds. */
const AGE_AMBIGUOUS_STEMS = /\b(?:teen|child|kid|loli|shota|school)\w*\b/iu;

/** Family-role / incest framing — banned regardless of how it is phrased. */
const FAMILY_ROLE_COPY =
  /\b(?:step[\s-]?(?:mom|mother|dad|father|sis|sister|bro|brother|son|daughter|cousin|aunt|uncle|parent)|mommy|mother|father|mom|dad|daddy|brother|sister|sis|son|daughter|cousin|aunt|uncle|niece|nephew|grandma|grandpa|incest|sibling|parent|family)\b/iu;

/** Non-consent, intoxication, helplessness or covert filming. */
const NON_CONSENT_COPY =
  /\b(?:rape|raped|raping|raper|forced|forcefully|coerc(?:e|ed|ion|ive)|non[\s-]?consensual|without\s+(?:(?:her|his|their|my)?\s*)?(?:consent|permission)|unwilling|drugged|drunk|tipsy|intoxicated|passed\s+out|unconscious|asleep|sleep(?:ing|y)\s+(?:girl|girlfriend|babe|woman|wife|amateur)|incapacitated|blackmail(?:ed)?|kidnap(?:ped)?|trapped|hidden\s+camera|secretly\s+film(?:ed|ing)|spycam|spy\s+cam|voyeur(?:ism|istic)?|creepshot|revenge\s+porn|brainwash\w*|hypno(?:tized|tism)?|captive|slip(?:s|ped|ping)?\s+(?:her|him|them|me|his)\s+a\s+drink|roofies?)\b/iu;

/** Explicit ages, which read as a claim about a real performer. */
const AGE_NUMBER_COPY = /\b\d{1,2}\s*[-\s]?\s*year[\s-]?olds?\b/iu;

/** Bestiality and necrophilia: never generated, never stored. */
const ILLEGAL_CONTENT_COPY =
  /\b(?:bestial(?:ity)?|animal\s+sex|zoo(?:philia|phil)|necro(?:philia)?|dead\s+bodies?|taxidermy|incest(?:ual)?|beastiality)\b/iu;

/** The full compliance floor, shared by every voice and every code path. */
export const NON_NEGOTIABLE_COPY_PATTERNS: readonly RegExp[] = [
  AGE_AMBIGUOUS_COPY,
  AGE_AMBIGUOUS_STEMS,
  FAMILY_ROLE_COPY,
  NON_CONSENT_COPY,
  AGE_NUMBER_COPY,
  ILLEGAL_CONTENT_COPY,
];

/**
 * Graphic sexual vocabulary, used only to keep the `editorial` voice clean.
 * It is not a compliance rule: the `explicit` voice is expected to use these
 * words, so they are never a reason to reject a title there.
 */
export const GRAPHIC_SEXUAL_COPY =
  /\b(?:cock|pussy|pussies|cunt|dick|penis|shaft|prick|vagina|clitoris|clit|tits?|boobs?|nipples?|sluts?|whores?|bitches|cum(?:ming|shot)?|creampie|blowjobs?|handjobs?|titjobs?|deep[\s-]?throat|fuck(?:s|ed|ing)?|motherfuck\w*|orgasms?|squir(?:t|ted|ting)|ejaculat(?:e|es|ed|ion)|facesitting|analphil(?:ia)?|rim(?:job|ming)?|strapons?|ballbust|footjob)\b/iu;

/** Compliance rules in the order they are checked, each with the patterns that breach it. */
const COMPLIANCE_RULES: ReadonlyArray<readonly [label: string, patterns: readonly RegExp[]]> = [
  ["age-ambiguous wording", [AGE_AMBIGUOUS_COPY, AGE_AMBIGUOUS_STEMS]],
  ["family-role or incest wording", [FAMILY_ROLE_COPY]],
  ["non-consensual or covert-filming wording", [NON_CONSENT_COPY]],
  ["an age claim", [AGE_NUMBER_COPY]],
  ["unlawful content wording", [ILLEGAL_CONTENT_COPY]],
];

/**
 * The first compliance rule the text breaks, naming the offending words so a
 * retry prompt can tell the model exactly what to drop. `null` when clean.
 */
export function copyComplianceViolation(text: string): string | null {
  const value = String(text ?? "");
  for (const [label, patterns] of COMPLIANCE_RULES) {
    for (const pattern of patterns) {
      const match = value.match(pattern);
      if (match) return `${label} ("${match[0].trim()}")`;
    }
  }
  return null;
}

/**
 * Guardrails applied to generated copy for one voice.
 *
 * `editorial` additionally rejects graphic sexual vocabulary, which is what
 * made the previous behaviour ("... Candid Boudoir Revelation") so unlike the
 * explicit titles the site now wants. `explicit` rejects only the compliance
 * floor.
 */
export function isCompliantGeneratedCopy(
  title: string,
  description: string,
  style: TitleStyle = DEFAULT_TITLE_STYLE,
): string | null {
  const text = `${title}\n${description}`;
  const violation = copyComplianceViolation(text);
  if (violation) return violation;
  if (style === "editorial" && GRAPHIC_SEXUAL_COPY.test(text)) return "graphic sexual wording in editorial copy";
  return null;
}

export function isCompliantCopy(
  title: string,
  description: string,
  style: TitleStyle = DEFAULT_TITLE_STYLE,
): boolean {
  return isCompliantGeneratedCopy(title, description, style) === null;
}

/**
 * Vocabulary rules for a voice: the explicit voice has to name the act, and the
 * editorial voice has to keep it implied. Returns the reason for rejection, or
 * `null` when the title is on-voice.
 */
export function titleKeywordViolation(title: string, style: TitleStyle): string | null {
  const value = String(title ?? "");
  if (style === "explicit") {
    if (!containsRequiredExplicitTerm(value)) {
      return "title must name the sex plainly (fuck, cock, dick, pussy, ass, blowjob, creampie or similar)";
    }
    if (containsEditorialTell(value)) {
      return "title must not use euphemistic magazine wording";
    }
    return null;
  }
  if (containsExplicitVocabulary(value)) {
    return "title must stay non-graphic in the editorial voice";
  }
  return null;
}

/** Word and character window for a voice. */
export function titleLengthViolation(
  title: string,
  style: TitleStyle,
  wordCount: number,
): string | null {
  const words = titleWordBudget(style);
  const characters = titleCharBudget(style);
  const length = String(title ?? "").trim().length;
  if (wordCount < words.min) return `title must contain at least ${words.min} words`;
  if (wordCount > words.max) return `title must contain at most ${words.max} words`;
  if (length < characters.min) return `title must be at least ${characters.min} characters`;
  if (length > characters.max) return `title must be at most ${characters.max} characters`;
  return null;
}

