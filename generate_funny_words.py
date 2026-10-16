#!/usr/bin/env python3
# Generate 2000 funny words for usernames

funny_words = []

# Base funny words from various categories
categories = {
    "animals": ["goose", "duck", "quack", "honk", "moo", "neigh", "baa", "arf", "woof", "purr",
                "meow", "paw", "claw", "tail", "fur", "fang", "whisker", "hoof", "clipclop"],
    "food": ["waffle", "pickle", "noodle", "taco", "burrito", "salsa", "wasabi", "kimchi",
             "syrup", "macaroni", "cheese", "guacamole", "guac", "wasabi", "kimchi"],
    "actions": ["wobble", "fumble", "giggle", "wiggle", "jiggle", "hobble", "stumble", "bumble",
                "nibble", "dribble", "totter", "clomp", "clatter", "clank", "clunk", "thump",
                "bump", "bang", "crash", "smash", "thwack", "whack", "smack", "pat", "poke",
                "prance", "skip", "hop", "jump", "leap", "bound", "hurdle", "sprint", "scamper",
                "scurry", "lop", "limp", "shuffle", "slide", "glide", "coast", "cruise", "dart",
                "zip", "zoom", "whizz", "zoomies", "scat", "prance", "mince", "cringe", "slink",
                "slither", "writhe", "wallow", "flop", "flop-flop", "floppy"],
    "adjectives": ["zany", "wacky", "kooky", "loony", "bonky", "wonky", "dizzy", "batty", "cuckoo",
                   "daffy", "silly", "ridiculous", "absurd", "preposterous", "outrageous", "wacko",
                   "wackorama", "crazy", "silly-goose", "silly-willy", "sillyhead", "sillybillie",
                   "sillypants", "sillygoose", "fuzzy", "fuzzball", "fuzzbucket", "fuzznut",
                   "fuzzlightyear", "floof", "floofball", "floofers", "floofa", "floofy", "floofen",
                   "goofy", "goofball", "goofus", "goofology", "goofiness", "kooky", "kook", "kookiness",
                   "kwick", "zaniness", "wackiness", "wacko", "looniness", "daffiness", "hysterical",
                   "hilarious", "comical", "comedy", "comic", "comedian", "jocular", "joke", "joker",
                   "prank", "prankster", "gag", "gaggle", "gags", "humor", "humour", "fun", "funnybone",
                   "laugh", "laugh-out-loud", "lol", "rofl", "roflmao", "lmao", "haha", "hohoho",
                   "hehe", "teehee", "snicker", "snicker-snack", "snort", "snort-snort", "snorter",
                   "snorty", "snuffle", "snuggle", "cuddle", "cuddles", "cuddlebug", "cuddle-puddle",
                   "ridikulus", "rediculus", "preposterus", "caricature", "schmack", "schmoo", "schmutz",
                   "schnozzle", "dweeb", "dorkus", "nerdia", "geekus", "bozo", "jesterville",
                   "prankster", "gaggle", "blob", "blop", "blip", "bloop", "blup", "blurp", "blarf",
                   "bleep", "blip-blop", "blip-bloop", "blippity", "blippo", "blippo-boo", "blippo-bah",
                   "blippo-beep", "blippo-bloop", "blippity-boo", "glorp", "glub", "glurch", "gloop",
                   "gloob", "gluk", "gobble", "gobbler", "gobble-dee", "gobble-dee-gunk", "googoo",
                   "googoo-gaga", "goo-goo", "goo-goo-ga-ga", "giggle", "giggly", "gigglepop",
                   "giggle-snort", "chuckle", "chucklehead", "chuckles", "chuckle-a-roo", "chortle",
                   "chortlehead", "chortles", "chortlebot", "snicker", "snickerdoodle", "snickers",
                   "snort", "snorter", "snorty", "snuffle", "snuggle", "cuddle", "cuddles", "cuddlebug",
                   "cuddle-puddle", "silly", "sillygoose", "sillyhead", "sillypants", "zany", "zanyism",
                   "wacky", "wackiness", "kooky", "kookiness", "loony", "looniness", "daffy", "daffiness",
                   "wacko", "wackorama", "crazy", "craziness", "silly", "silliness", "ridiculous",
                   "absurd", "preposterous", "outrageous", "caricature", "schmack", "schmoo", "schmutz",
                   "schnozzle", "dweeb", "dorkus", "nerdia", "geekus", "bozo", "jesterville",
                   "prankster", "gaggle"],
}

for category, words in categories.items():
    for word in words:
        if len(funny_words) >= 2000:
            break
        funny_words.append(word)

# Generate additional funny words by combining parts
prefixes = ["goo", "bloo", "floo", "gloo", "blip", "bloop", "zib", "zibble", "nizz", "fizz"]
suffixes = ["y", "ie", "o", "arff", "le", "berry", "nugget", "burger", "finox", "pants"]

for p in prefixes:
    for s in suffixes:
        if len(funny_words) >= 2000:
            break
        word = p + s
        if len(word) >= 3 and len(word) <= 20:
            funny_words.append(word)
    if len(funny_words) >= 2000:
        break

# Add more generated combinations to reach 2000
while len(funny_words) < 2000:
    length = 3 + (len(funny_words) % 8)
    word = ""
    for j in range(length):
        if j % 2 == 0:
            consonants = "bcdfghjklmnpqrstvwxz"
            word += consonants[len(funny_words) % len(consonants)]
        else:
            vowels = "aeiou"
            word += vowels[len(funny_words) % len(vowels)]
    if word not in funny_words and len(word) >= 3 and len(word) <= 20:
        funny_words.append(word)

# Deduplicate while preserving order
seen = set()
unique_words = []
for w in funny_words:
    if w not in seen:
        seen.add(w)
        unique_words.append(w)
    if len(unique_words) >= 2000:
        break

# Write to file
with open("/home/user/erobabe/src/utils/funny-words.ts", "w") as f:
    f.write("export const FUNNY_WORDS: string[] = [\n")
    for w in unique_words[:2000]:
        f.write(f"  '{w}',\n")
    f.write("];\n")

print(f"Generated {len(unique_words[:2000])} funny words")
print(f"Total before dedup: {len(funny_words)}")