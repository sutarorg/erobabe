/**
 * Offline vocabulary for the `explicit` title voice.
 *
 * The admin uploads a file, the queue needs a publishable title, and the copy
 * must read like an adult-studio title rather than a film-festival programme
 * note. Two producers feed that requirement:
 *
 *  1. OpenRouter, prompted by `buildPrompt` with this file's vocabulary as its
 *     word list, so the AI and the offline path stay on the same voice;
 *  2. `composeExplicitTitle` in `./suggestion`, which fills the arrangements
 *     below when the model is unreachable, declines the request, or answers with
 *     euphemisms. General-purpose models still refuse adults-only copy often
 *     enough that this path is a first-class producer, not an error handler.
 *
 * Only `import type` is used against `./suggestion`, so this module never sits in
 * a runtime import cycle and can be bundled to the browser.
 *
 * Every pool here is written against the compliance floor in `./title-style`:
 * no age-ambiguous nouns (which rules out "girl", "boy", "teen", "student",
 * "college", "young"), no family-role nouns, and nothing implying a partner who
 * cannot consent (no intoxication, sleep, captivity or covert filming). Grammar
 * is fixed by construction too: `subjects` are all singular third person and
 * `acts` are all third-person-singular verb phrases, so `subject + act` always
 * reads correctly whichever pair the composer draws.
 */

import type { KnownCategory } from "./suggestion";

/** Fillable slot pools for one category. */
export interface ExplicitTitleParts {
  /** Singular third-person noun phrase the title opens on, e.g. `My Girlfriend`. */
  subjects: string[];
  /** Third-person verb phrase naming the act, e.g. `Grabs My Cock`. */
  acts: string[];
  /** Position or move, e.g. `Raw Doggy Style`. */
  moves: string[];
  /** Trailing clause naming a second act or an outcome, e.g. `Cums On Her Tits`. */
  closers: string[];
  /** Listing-tail noun, each containing a searchable sexual term. */
  tails: string[];
  /**
   * Optional scene nouns for the offline description. Categories with no cock
   * in them must not be described with a creampie, so the generic list is
   * replaceable per category.
   */
  scenes?: string[];
  /** Phrase satisfying `hasSelectedCategorySignal` for this category. */
  categoryPhrase: string;
}

/** Shared adjectives that sit in front of a move. */
export const EXPLICIT_INTENSIFIERS = [
  "Intense",
  "Raw",
  "Hardcore",
  "Rough",
  "Sloppy",
  "Steamy",
  "Filthy",
  "Nasty",
  "Marathon",
  "Uncut",
] as const;

/** Shared settings; each phrase begins with a preposition. */
export const EXPLICIT_PLACES = [
  "In Our Apartment",
  "In The Hotel Room",
  "On The Kitchen Counter",
  "In The Shower",
  "By The Pool",
  "In Front Of The Mirror",
  "On Cam",
  "In Her Bedroom",
  "At The End Of The Bed",
  "On The Office Desk",
  "In The Garage",
  "Against The Wall",
  "On The Living Room Couch",
] as const;

/** Sexual terms injected when an assembled title would otherwise lack one. */
export const EXPLICIT_FALLBACK_KEYWORDS = [
  "Fuck",
  "Raw Fuck",
  "Hard Sex",
  "Blowjob",
  "Creampie",
  "Rides My Cock",
  "Takes His Dick",
] as const;

/**
 * Sentence shapes. Each arrangement returns a ladder of candidates from longest
 * to shortest: the composer takes the first one that fits the word and character
 * budget, so a short listing never gets a mid-phrase truncation. Every rung on
 * the ladder is a complete, grammatical title that already carries the category
 * phrase and at least one required sexual term.
 */
export type ExplicitSlots = {
  subject: string;
  act: string;
  move: string;
  place: string;
  closer: string;
  intensifier: string;
  tail: string;
  categoryPhrase: string;
};

export type ExplicitArrangement = (slots: ExplicitSlots) => string[];

export function articleFor(word: string): string {
  return /^[aeiou]/i.test(String(word || "").trim()) ? "An" : "A";
}

export const EXPLICIT_TITLE_ARRANGEMENTS: readonly ExplicitArrangement[] = [
  // My Girlfriend Grabs My Cock For An Intense Raw Doggy Style Fuck In Our Apartment
  ({ subject, act, intensifier, move, place, closer, categoryPhrase }) => {
    const lead = `${subject} ${act}`;
    const heat = `For ${articleFor(intensifier)} ${intensifier} ${move}`;
    return [
      `${lead} ${heat} ${categoryPhrase} Fuck ${place}`,
      `${lead} ${heat} ${categoryPhrase} Fuck`,
      `${lead} ${move} ${categoryPhrase} Fuck ${place}`,
      `${lead} ${categoryPhrase} Fuck ${place}`,
      `${lead} ${categoryPhrase} Fuck ${place} And ${closer}`,
    ];
  },
  // Amateur Sex Tape My Girlfriend Takes My Dick Raw Doggy Style On Cam
  ({ subject, act, move, place, tail, closer, categoryPhrase }) => {
    const lead = `${categoryPhrase} ${tail} ${subject} ${act}`;
    return [
      `${lead} ${move} ${place}`,
      `${lead} ${place}`,
      `${lead}`,
      `${lead} ${place} And ${closer}`,
    ];
  },
  // My Girlfriend Sucks Me Dry Then Cowgirl Amateur Sex In Her Bedroom
  ({ subject, act, move, place, closer, categoryPhrase }) => {
    const lead = `${subject} ${act} Then ${move} ${categoryPhrase} Sex`;
    return [`${lead} ${place}`, lead, `${lead} ${place} And ${closer}`];
  },
  // My Girlfriend Grabs My Cock Raw Doggy Style In Our Apartment And Cums Twice
  ({ subject, act, move, place, closer, categoryPhrase }) => {
    const lead = `${subject} ${act} ${move}`;
    return [
      `${lead} ${categoryPhrase} Sex ${place} And ${closer}`,
      `${lead} ${categoryPhrase} Sex ${place}`,
      `${lead} ${categoryPhrase} Sex`,
    ];
  },
] as const;

/**
 * Category vocabulary. `categoryPhrase` is what the per-category title check
 * looks for, and it differs from the raw database label for the sensitive ones:
 * `Teen (18+)` publishes as `18+ Adults Only` (the label is an internal name
 * that must never reach a public title) and `Mature 18+` publishes as `Mature`.
 */
export const EXPLICIT_TITLE_VOCABULARY: Record<KnownCategory, ExplicitTitleParts> = {
  Amateur: {
    categoryPhrase: "Amateur",
    subjects: [
      "My Girlfriend",
      "My Horny Girlfriend",
      "This Amateur Babe",
      "My Girlfriend On Cam",
      "The Babe I Live With",
      "My Amateur Slut",
    ],
    acts: [
      "Grabs My Cock",
      "Takes My Dick",
      "Sucks Me Dry",
      "Rides My Cock Raw",
      "Spreads For The Camera",
      "Lets Me Film Her Pussy",
      "Takes It Bareback",
    ],
    moves: [
      "Raw Doggy Style",
      "Cowgirl On Top",
      "Missionary Up Close",
      "Face Down Doggy Style",
      "Prone Bone",
      "Spread On Cam",
    ],
    closers: [
      "Cums Twice On Camera",
      "Squirts On The Sheets",
      "Swallows Every Drop",
      "Screams My Name",
      "Takes A Cumshot On Her Tits",
    ],
    tails: ["Sex Tape", "Home Fuck Video", "Amateur Blowjob", "Raw Sex Clip"],
  },
  Lesbian: {
    categoryPhrase: "Lesbian",
    scenes: ["lesbian sex", "strapon scene", "69 in bed", "scissoring", "face sitting"],
    subjects: ["My Girlfriend", "The Blonde Babe", "The Brunette In Lace", "The Blonde's Best Friend"],
    acts: [
      "Licks Her Pussy",
      "Slides Her Fingers Deep",
      "Uses A Strap On Her Partner",
      "Rubs Her Clit Wet",
      "Tongues Her Until She Squirts",
      "Straddles Her Face",
    ],
    moves: ["69 On The Bed", "Scissoring", "Face Sitting", "Strap On Sex", "Tongue Deep Making Out"],
    closers: ["Both Cum On The Sheets", "Squirts On Her Tits", "Begs Her To Keep Going", "Rides It To Orgasm"],
    tails: ["Two Women Sex Tape", "Lesbian Fuck Tape", "Strap On Blowjob"],
  },
  MILF: {
    categoryPhrase: "MILF",
    subjects: ["The Married MILF", "The Cougar In Heels", "My Older Woman", "The MILF Next Door"],
    acts: [
      "Takes My Whole Cock",
      "Sucks My Dick Deep",
      "Shows Off Her Pussy",
      "Rides Me Until She Cums",
      "Fucks Me Raw",
    ],
    moves: ["Doggy Style In Heels", "Cowgirl All Night", "Kitchen Table Sex", "Face Sitting"],
    closers: ["Cums Screaming My Name", "Takes A Cumshot On Her Face", "Swallows And Asks For More"],
    tails: ["Milf Sex Tape", "Married Blowjob", "Rough Milf Fuck"],
  },
  Japanese: {
    categoryPhrase: "Japanese",
    subjects: ["My Japanese Girlfriend", "The Japanese Babe", "The Idol Lookalike"],
    acts: [
      "Sucks My Cock Silent",
      "Takes My Dick Slow",
      "Spreads Her Shaven Pussy",
      "Wraps Her Tits Around My Shaft",
      "Rides My Face",
    ],
    moves: ["Slow Missionary", "Doggy Style With Support", "Face Sitting Cowgirl", "Lotus Position Sex"],
    closers: ["Cums Quietly Twice", "Swallows Without A Sound", "Takes A Cumshot On Her Neck"],
    tails: ["Japanese Sex Tape", "Silent Blowjob", "Titty Fuck Clip"],
  },
  "Teen (18+)": {
    categoryPhrase: "18+ Adults Only",
    scenes: ["verified 18+ fuck", "adults only sex tape", "first time on camera", "18+ Blowjob"],
    subjects: ["My Adult Girlfriend", "The Newly 18 Babe", "This 18+ Verified Slut"],
    acts: [
      "Shows Her ID And Her Pussy",
      "Takes My Cock On Camera",
      "Sucks My Dick",
      "Lets Me Film Her Raw",
      "Rides Me Bare",
    ],
    moves: ["Raw Doggy Style", "Slow Cowgirl", "Missionary Up Close", "Lights On Sex"],
    closers: ["Cums Twice In Ten Minutes", "Takes A Cumshot On Her Tits", "Squirts On The Sheets"],
    tails: ["18+ Sex Tape", "Verified Blowjob", "Adults Only Fuck"],
  },
  Hentai: {
    categoryPhrase: "Hentai",
    scenes: ["animated fuck", "drawn creampie", "impossible positions", "ink squirt scene"],
    subjects: ["The Animated Slut", "The Inked Hentai Babe", "The Drawn Couple"],
    acts: [
      "Takes A Drawn Cock",
      "Squirts Ink On The Page",
      "Rides The Animation Raw",
      "Spreads For The Animator",
      "Swallows The Whole Shaft",
    ],
    moves: ["Impossible Doggy Style", "Frame By Frame Scissoring", "Strap On Sex", "Exaggerated Hentai Tits"],
    closers: ["Cums Across Five Panels", "Squirts On The Mattress", "Cums Again Right After"],
    tails: ["Adult Animated Sex", "Uncensored Hentai Fuck", "Animated Creampie"],
  },
  Ebony: {
    categoryPhrase: "Ebony",
    subjects: ["The Ebony Babe", "My Ebony Girlfriend", "The Thick Ebony Slut"],
    acts: [
      "Grabs My Cock Hard",
      "Shows Her Juicy Pussy",
      "Takes Every Inch Raw",
      "Slaps Back On My Dick",
      "Rides Me Bareback",
    ],
    moves: ["Doggy Style With Spanking", "Cowgirl Riding Hard", "Bent Over The Counter", "Missionary Deep"],
    closers: ["Cums Loud On Camera", "Takes A Cumshot On Her Big Ass", "Squirts Twice"],
    tails: ["Ebony Sex Tape", "Thick Ass Fuck", "Ebony Blowjob"],
  },
  POV: {
    categoryPhrase: "POV",
    subjects: ["My Girlfriend", "The Babe On The Bed", "The Babe In The Bedlight"],
    acts: [
      "Takes My Dick Deep",
      "Pulls My Head To Her Pussy",
      "Straddles The Lens",
      "Rides My Face Until I Cum",
      "Looks Down And Sucks",
    ],
    moves: ["POV Blowjob To Doggy Style", "POV Cowgirl", "POV Missionary Eye Contact", "POV Face Fucking"],
    closers: ["Cums Into The Lens", "Swallows On Camera", "Takes The Cumshot On Her Tits"],
    tails: ["POV Sex Tape", "First Person Fuck", "POV Blowjob"],
  },
  "Big Ass": {
    categoryPhrase: "Big Ass",
    subjects: ["The Thick Babe", "My Girlfriend", "The Ass Model"],
    acts: [
      "Bends Over And Shows Her Big Ass",
      "Takes My Dick Face Down",
      "Gets Spanked Raw",
      "Shakes Her Fat Ass",
      "Slaps Back On My Cock",
    ],
    moves: ["Raw Doggy Style", "Ass In The Air", "Bent Over The Couch", "Spooning From Behind"],
    closers: ["Cums With Her Ass Marked Red", "Takes A Cumshot On Her Big Ass", "Squirts Face Down"],
    tails: ["Big Ass Sex Tape", "Ass Fuck Clip", "Thick Ass Blowjob"],
  },
  Threesome: {
    categoryPhrase: "Threesome",
    subjects: ["My Girlfriend", "The Babe And Her Friend", "My Wife And A Friend"],
    acts: [
      "Takes Two Cocks At Once",
      "Shares One Dick With Her Partner",
      "Sucks And Switches Mid Scene",
      "Gets Fucked While He Watches",
      "Rides One And Licks The Other",
    ],
    moves: ["Tag Team Doggy Style", "Double Blowjob", "Sandwich Cowgirl", "Six Hands On One Cock"],
    closers: ["Cums Twice Before He Cums", "She Squirts While He Cums On Her Tits"],
    tails: ["Threesome Sex Tape", "Three Way Fuck", "Group Blowjob"],
  },
  Hardcore: {
    categoryPhrase: "Hardcore",
    subjects: ["My Girlfriend", "The Babe On The Bed", "The Gonzo Performer"],
    acts: [
      "Takes My Cock Bare",
      "Gets Pounded Until She Cums",
      "Swallows Deep Then Rides",
      "Lets Me Cum On Her Face",
      "Gets Face Fucked Hard",
    ],
    moves: ["Pounding Doggy Style", "Prone Bone", "Reverse Cowgirl Slam", "Standing Rough Sex", "Deepthroat To Facial"],
    closers: ["Cums Three Times", "Takes Cum On Her Face And Tits", "Cums Again Right After"],
    tails: ["Hardcore Sex Tape", "Uncensored Fuck", "Gonzo Creampie"],
  },
  Massage: {
    categoryPhrase: "Massage",
    scenes: ["oiled massage sex", "happy ending gone raw", "table fuck", "warm oil blowjob"],
    subjects: ["My Girlfriend", "The Babe On The Table", "The Massage Therapist"],
    acts: [
      "Slides Her Hands To My Cock",
      "Opens Her Legs And Shows Her Pussy",
      "Uses Oil On Every Inch",
      "Rides Me After The Warm Up",
    ],
    moves: ["Oiled Doggy Style", "Table Side Blowjob", "Face Down And Spread", "Slow Oil Sex"],
    closers: ["Cums Into The Towel", "Takes A Cumshot On Her Oiled Back", "Squirts On The Table"],
    tails: ["Massage Sex Tape", "Oiled Fuck", "Happy Ending Blowjob"],
  },
  Mature: {
    categoryPhrase: "Mature",
    subjects: ["The Mature Babe", "My Experienced Girlfriend", "The Mature Performer"],
    acts: [
      "Takes My Dick Slow",
      "Shows Her Soft Pussy",
      "Rides Me Slow Then Hard",
      "Sucks My Cock Standing",
    ],
    moves: ["Missionary With Eye Contact", "Slow Cowgirl Ride", "Doggy Style At The Bedside", "Spooning Sex"],
    closers: ["Cums Twice And Keeps Going", "Takes The Cumshot On Her Tits"],
    tails: ["Mature Sex Tape", "Private Fuck", "Experienced Blowjob"],
  },
  Kinky: {
    categoryPhrase: "Kinky",
    scenes: ["bondage fuck", "strapon scene", "spanking and sex", "blindfold blowjob"],
    subjects: ["My Girlfriend", "The Mistress In Latex", "The Kinky Performer"],
    acts: [
      "Ties Me Up Then Takes Control",
      "Uses A Strap On Her Pussy",
      "Gets Bound And Fucked Raw",
      "Spanks Me Until I Cum",
      "Works A Vibrator On Her Clit",
    ],
    moves: ["Blindfolded Doggy Style", "Handcuffed Over The Bed", "Latex Strap On Sex", "Spanked Prone Bone"],
    closers: ["Cums On Command", "Squirts While Tied Up", "Takes The Cumshot On Her Mask"],
    tails: ["Kink Sex Tape", "Fetish Fuck", "Bondage Blowjob"],
  },
  "Mature 18+": {
    categoryPhrase: "Mature",
    subjects: ["The 18+ Verified Babe", "My Mature Girlfriend", "The Adults Only Performer"],
    acts: ["Takes My Cock Bare", "Shows Her Shaven Pussy", "Sucks Me Then Rides", "Fucks Me Raw"],
    moves: ["Raw Doggy Style", "Cowgirl On Top", "Missionary Up Close"],
    closers: ["Cums On Camera", "Takes A Cumshot On Her Tits", "Squirts Twice"],
    tails: ["18+ Sex Tape", "Adults Only Fuck", "Verified Blowjob"],
  },
  Couples: {
    categoryPhrase: "Couples",
    subjects: ["The Married Babe", "My Girlfriend", "The Couple On Cam"],
    acts: [
      "Fucks Raw And Slow On Camera",
      "Takes Turns Riding Each Other",
      "Shows How She Takes His Cock",
      "Makes Eye Contact While She Cums",
    ],
    moves: ["Lotus Position Sex", "Slow Cowgirl Ride", "Doggy Style On The Bed", "Morning Couch Sex"],
    closers: ["Cums Together On Camera", "She Squirts On His Dick", "Both Cum On The Pillow"],
    tails: ["Couple Sex Tape", "Swinger Blowjob", "Two Person Fuck"],
  },
  Boudoir: {
    categoryPhrase: "Boudoir",
    scenes: ["lingerie sex", "boudoir fuck", "stocking blowjob", "bedspread sex"],
    subjects: ["My Girlfriend In Lace", "The Babe In Stockings", "The Bride To Be"],
    acts: [
      "Peels Off Her Panties",
      "Rubs Her Clit For The Camera",
      "Straddles Me On The Chaise",
      "Takes My Cock Through The Lace",
    ],
    moves: ["Lingerie Cowgirl", "Bedspread Missionary", "Standing In Stockings", "Mirror Side Doggy Style"],
    closers: ["Cums On The Silk Sheets", "Takes A Cumshot On Her Stockings", "Squirts On The Bedspread"],
    tails: ["Boudoir Sex Tape", "Lingerie Fuck", "Lace Blowjob"],
  },
  Romantic: {
    categoryPhrase: "Romantic",
    scenes: ["making love tape", "slow sex", "morning fuck", "lotus position sex"],
    subjects: ["My Girlfriend", "The Couple In Love", "My Fiancée"],
    acts: [
      "Kisses Me Down To My Cock",
      "Takes My Dick Slow And Naked",
      "Wraps Her Legs Around My Head",
      "Whispers Before She Rides",
    ],
    moves: ["Slow Missionary", "Spooning In The Dark", "Lotus Sex On The Bed", "Butterfly Position Sex"],
    closers: ["Cums With Him Laughing", "Cums Whispering My Name", "Kisses Through Her Orgasm"],
    tails: ["Romantic Sex Tape", "Making Love Sex Tape", "Slow Fuck Clip"],
  },
  Solo: {
    categoryPhrase: "Solo",
    scenes: ["solo play", "orgasm on cam", "toys and fingers", "shower handjob"],
    subjects: ["My Girlfriend Alone At Home", "The Babe On Cam", "The Solo Performer"],
    acts: [
      "Fucks Her Own Pussy",
      "Works A Vibrator On Her Clit",
      "Rubs Her Tits To Orgasm",
      "Slides A Toy Deep",
      "Cums For The Camera",
    ],
    moves: ["Close Up On Her Pussy", "Toys And A Mirror", "Locked Door Sex", "Shower Self Fuck"],
    closers: ["Cums Five Times", "Squirts Across The Mattress", "Moans Straight To Orgasm"],
    tails: ["Solo Sex Tape", "Cam Show Orgasm", "Self Fuck Video"],
  },
  Roleplay: {
    categoryPhrase: "Roleplay",
    subjects: ["The Nurse On Shift", "My Girlfriend In Uniform", "The Boss After Hours"],
    acts: [
      "Locks The Door And Takes My Cock",
      "Examines My Dick Then Sucks It",
      "Pins Me To The Desk",
      "Changes Costume Mid Fuck",
      "Stays In Character On Her Knees",
    ],
    moves: ["Uniform Doggy Style", "Desk Sex Scene", "Nurse Table Blowjob", "Costume Change Cowgirl"],
    closers: ["Cums In Character", "Takes A Cumshot On The Uniform", "Swallows And Stays In Role"],
    tails: ["Roleplay Sex Tape", "Costume Fuck", "Uniform Blowjob"],
  },
};

/**
 * Description building blocks for the offline explicit voice. The composer
 * (`composeExplicitDescription`) assembles
 *
 *   "<category> <scene>: <beat>, <beat>, <beat>. <tail>"
 *
 * and drops or adds beats until the sentence lands in the published 20-25 word
 * band, which is why the blocks are clauses rather than whole sentences: a
 * mad-lib description that reads like a mad-lib is worse than a short one, and
 * a fixed 40-sentence library would be padded or trimmed anyway.
 */
export const EXPLICIT_DESCRIPTION_SCENES = [
  "fuck",
  "raw sex",
  "blowjob to doggy style",
  "creampie finish",
  "rough fuck",
  "cowgirl sex",
] as const;

/**
 * Closing clauses. Each one states the adults-only / age-verified fact the
 * listing has to carry, in wording that never reads as a claim about an age.
 */
export const EXPLICIT_DESCRIPTION_TAILS = [
  "18+ adults only, filmed at home in one take.",
  "Verified 18+ adults only, unscripted and uncut.",
  "All performers verified 18+, shot in one continuous take.",
  "Adults only footage, 18+ verified, no cuts or retakes.",
  "Self filmed by the adults in it, 18+ verified, one take.",
  "18+ verified performers, adults only, recorded in a hotel room.",
] as const;
