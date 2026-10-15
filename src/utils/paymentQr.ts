/**
 * Payment URI & SVG QR code generator (ISO/IEC 18004, Level L, Byte mode).
 *
 * Encodes both the destination address and the exact payable amount into a
 * standard payment URI so scanning the QR code in a payment/wallet app
 * directly populates the payable amount.
 */

export interface PaymentQrInput {
  address?: string;
  payAddress?: string;
  amount?: string | number | null;
  payAmount?: string | number | null;
  priceUSD?: string | number | null;
  paymentCurrency?: string | null;
  payCurrency?: string | null;
  chain?: string | null;
  network?: string | null;
}

const USDT_ERC20_CONTRACT = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const CHAIN_SCHEME: Record<string, string> = {
  ethereum: "ethereum",
  "ethereum (erc-20)": "ethereum",
  bitcoin: "bitcoin",
  solana: "solana",
  tron: "tron",
  binance: "bnb",
};

function toAtomicUnits(amount: string, decimals: number): string | null {
  const cleaned = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const paddedFrac = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw = (whole + paddedFrac).replace(/^0+/, "");
  return raw || "0";
}

/**
 * Builds a payment URI containing the receiving address and payable amount.
 * Default asset/network is USDT on Ethereum.
 */
export function buildPaymentUri(input: PaymentQrInput): string {
  const address = String(input.payAddress || input.address || "").trim();
  const chainKey = String(
    input.chain || input.network || "ethereum",
  )
    .trim()
    .toLowerCase();
  const currency = String(
    input.payCurrency || input.paymentCurrency || "usdterc20",
  )
    .trim()
    .toLowerCase();
  const scheme =
    CHAIN_SCHEME[chainKey] ||
    (chainKey.includes("ethereum") || chainKey.includes("erc")
      ? "ethereum"
      : "ethereum");
  const rawAmount =
    input.payAmount !== undefined &&
    input.payAmount !== null &&
    String(input.payAmount).trim() !== ""
      ? String(input.payAmount).trim()
      : input.amount !== undefined &&
          input.amount !== null &&
          String(input.amount).trim() !== ""
        ? String(input.amount).trim()
        : input.priceUSD !== undefined &&
            input.priceUSD !== null &&
            String(input.priceUSD).trim() !== ""
          ? String(input.priceUSD).trim()
          : "";

  if (!rawAmount) {
    return `${scheme}:${address}`;
  }

  if (
    scheme === "ethereum" &&
    address.startsWith("0x") &&
    currency.includes("usdt")
  ) {
    const atomic = toAtomicUnits(rawAmount, 6);
    if (atomic) {
      return `ethereum:${USDT_ERC20_CONTRACT}@1/transfer?address=${address}&uint256=${atomic}`;
    }
  }

  return `${scheme}:${address}?amount=${encodeURIComponent(rawAmount)}`;
}

/* ------------------------------------------------------------------ */
/* ISO/IEC 18004 QR Code Matrix (Level L, Byte Mode, Versions 1-10)   */
/* ------------------------------------------------------------------ */

interface VersionSpec {
  version: number;
  totalCodewords: number;
  ecCodewordsPerBlock: number;
  numBlocks: number;
  alignment: number[];
}

const VERSION_SPECS: VersionSpec[] = [
  { version: 1, totalCodewords: 26, ecCodewordsPerBlock: 7, numBlocks: 1, alignment: [] },
  { version: 2, totalCodewords: 44, ecCodewordsPerBlock: 10, numBlocks: 1, alignment: [6, 18] },
  { version: 3, totalCodewords: 70, ecCodewordsPerBlock: 15, numBlocks: 1, alignment: [6, 22] },
  { version: 4, totalCodewords: 100, ecCodewordsPerBlock: 20, numBlocks: 1, alignment: [6, 26] },
  { version: 5, totalCodewords: 134, ecCodewordsPerBlock: 26, numBlocks: 1, alignment: [6, 30] },
  { version: 6, totalCodewords: 172, ecCodewordsPerBlock: 18, numBlocks: 2, alignment: [6, 34] },
  { version: 7, totalCodewords: 196, ecCodewordsPerBlock: 20, numBlocks: 2, alignment: [6, 22, 38] },
  { version: 8, totalCodewords: 242, ecCodewordsPerBlock: 24, numBlocks: 2, alignment: [6, 24, 42] },
  { version: 9, totalCodewords: 292, ecCodewordsPerBlock: 30, numBlocks: 2, alignment: [6, 26, 46] },
  { version: 10, totalCodewords: 346, ecCodewordsPerBlock: 18, numBlocks: 4, alignment: [6, 28, 50] },
];

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function bchVersionInfo(version: number): number {
  let d = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((d >> i) & 1) {
      d ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | d;
}

export function encodeQrCodeMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const spec =
    VERSION_SPECS.find((s) => {
      const dataCap = s.totalCodewords - s.ecCodewordsPerBlock * s.numBlocks;
      const countBits = s.version <= 9 ? 8 : 16;
      return bytes.length + Math.ceil((4 + countBits) / 8) <= dataCap;
    }) || VERSION_SPECS[VERSION_SPECS.length - 1];

  const dataCodewords = spec.totalCodewords - spec.ecCodewordsPerBlock * spec.numBlocks;
  const countBits = spec.version <= 9 ? 8 : 16;
  const payload = bytes.slice(0, dataCodewords - 2);

  const bits: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // Byte mode indicator (0100) + character count + bytes
  pushBits(0b0100, 4);
  pushBits(payload.length, countBits);
  for (const b of payload) pushBits(b, 8);

  // Terminator (up to 4 zero bits)
  const maxBits = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < maxBits; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(dataCodewords);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i * 8 + b];
    }
    dataBytes[i] = byte;
  }
  const padBytes = [0xec, 0x11];
  for (let i = bits.length / 8; i < dataCodewords; i++) {
    dataBytes[i] = padBytes[(i - bits.length / 8) % 2];
  }

  // Split into blocks and compute Reed-Solomon EC
  const blockSize = Math.floor(dataCodewords / spec.numBlocks);
  const dataBlocks: Uint8Array[] = [];
  const ecBlocks: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < spec.numBlocks; b++) {
    const extra = b >= spec.numBlocks - (dataCodewords % spec.numBlocks) ? 1 : 0;
    const block = dataBytes.slice(offset, offset + blockSize + extra);
    offset += block.length;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, spec.ecCodewordsPerBlock));
  }

  const finalCodewords: number[] = [];
  const maxBlockLen = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxBlockLen; i++) {
    for (const block of dataBlocks) {
      if (i < block.length) finalCodewords.push(block[i]);
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (const block of ecBlocks) {
      finalCodewords.push(block[i]);
    }
  }

  const size = 17 + spec.version * 4;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const reserved: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunctionModule = (r: number, c: number, dark: boolean) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = dark;
    reserved[r][c] = true;
  };

  // Finder patterns + separators
  const placeFinder = (top: number, left: number) => {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const inOuter = r >= 0 && r <= 6 && c >= 0 && c <= 6;
        const onBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const inInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        setFunctionModule(top + r, left + c, inOuter && (onBorder || inInner));
      }
    }
  };
  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  // Alignment patterns
  for (const r of spec.alignment) {
    for (const c of spec.alignment) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
          setFunctionModule(r + dr, c + dc, dark);
        }
      }
    }
  }

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    if (!reserved[6][i]) setFunctionModule(6, i, i % 2 === 0);
    if (!reserved[i][6]) setFunctionModule(i, 6, i % 2 === 0);
  }

  // Reserve format info areas & dark module
  for (let i = 0; i <= 8; i++) {
    if (!reserved[8][i]) setFunctionModule(8, i, false);
    if (!reserved[i][8]) setFunctionModule(i, 8, false);
  }
  for (let i = 0; i < 8; i++) {
    if (!reserved[8][size - 1 - i]) setFunctionModule(8, size - 1 - i, false);
    if (!reserved[size - 1 - i][8]) setFunctionModule(size - 1 - i, 8, false);
  }
  setFunctionModule(size - 8, 8, true);

  // Version info for version >= 7
  if (spec.version >= 7) {
    const vInfo = bchVersionInfo(spec.version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vInfo >> i) & 1) === 1;
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      setFunctionModule(r, c, bit);
      setFunctionModule(c, r, bit);
    }
  }

  // Place data bits in upward/downward 2-column zigzag
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      const r = upward ? size - 1 - v : v;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (!reserved[r][c]) {
          let dark = false;
          if (bitIdx < totalBits) {
            const byte = finalCodewords[bitIdx >> 3];
            dark = ((byte >> (7 - (bitIdx & 7))) & 1) === 1;
            bitIdx++;
          }
          // Apply Mask 0: (r + c) % 2 === 0
          if ((r + c) % 2 === 0) dark = !dark;
          modules[r][c] = dark;
        }
      }
    }
    upward = !upward;
  }

  // Write Format Information for Level L (01) + Mask 0 (000) -> 0x77c4
  const formatBits = 0x77c4;
  for (let i = 0; i <= 5; i++) modules[8][i] = ((formatBits >> i) & 1) === 1;
  modules[8][7] = ((formatBits >> 6) & 1) === 1;
  modules[8][8] = ((formatBits >> 7) & 1) === 1;
  modules[7][8] = ((formatBits >> 8) & 1) === 1;
  for (let i = 9; i < 15; i++) modules[14 - i][8] = ((formatBits >> i) & 1) === 1;

  for (let i = 0; i < 8; i++) modules[8][size - 1 - i] = ((formatBits >> i) & 1) === 1;
  for (let i = 8; i < 15; i++) modules[size - 15 + i][8] = ((formatBits >> i) & 1) === 1;

  return modules;
}
