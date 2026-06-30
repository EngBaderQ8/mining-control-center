export type Cooling = "air" | "hydro" | "immersion";

export interface DeviceSpec {
  vendor: string; // manufacturer
  model: string; // canonical model name
  algo: string; // mining algorithm
  cooling: Cooling;
  boards: number; // hashboard count (typical)
  nominalTHs?: number; // approx rated hashrate (TH/s for SHA-256; GH/s noted otherwise)
}

interface CatalogEntry extends DeviceSpec {
  // lowercase keyword groups; ALL must appear in the normalized model string.
  match: string[];
}

// Curated reference of common ASIC miners. Ordered most-specific FIRST so longer
// model names win (e.g. "s19 xp hyd" before "s19"). cooling/boards drive accurate,
// false-alarm-free diagnostics (hydro = no fans; correct board count).
const CATALOG: CatalogEntry[] = [
  // —— Bitmain Antminer (SHA-256) ——
  { match: ["s21", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S21 XP Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 473 },
  { match: ["s21", "xp", "imm"], vendor: "Bitmain", model: "Antminer S21 XP Immersion", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 300 },
  { match: ["s21", "xp"], vendor: "Bitmain", model: "Antminer S21 XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 270 },
  { match: ["s21", "hyd"], vendor: "Bitmain", model: "Antminer S21 Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 335 },
  { match: ["s21", "pro"], vendor: "Bitmain", model: "Antminer S21 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 234 },
  { match: ["s21+", "hyd"], vendor: "Bitmain", model: "Antminer S21+ Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 358 },
  { match: ["s21+"], vendor: "Bitmain", model: "Antminer S21+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 216 },
  { match: ["s21"], vendor: "Bitmain", model: "Antminer S21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 200 },
  { match: ["t21"], vendor: "Bitmain", model: "Antminer T21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 190 },
  { match: ["s19", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S19 XP Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 257 },
  { match: ["s19", "xp"], vendor: "Bitmain", model: "Antminer S19 XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 141 },
  { match: ["s19", "pro+", "hyd"], vendor: "Bitmain", model: "Antminer S19 Pro+ Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 198 },
  { match: ["s19j", "pro+"], vendor: "Bitmain", model: "Antminer S19j Pro+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 120 },
  { match: ["s19j", "pro"], vendor: "Bitmain", model: "Antminer S19j Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 104 },
  { match: ["s19k", "pro"], vendor: "Bitmain", model: "Antminer S19k Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 120 },
  { match: ["s19", "pro", "hyd"], vendor: "Bitmain", model: "Antminer S19 Pro Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 177 },
  { match: ["s19", "pro"], vendor: "Bitmain", model: "Antminer S19 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 110 },
  { match: ["s19", "hyd"], vendor: "Bitmain", model: "Antminer S19 Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 158 },
  { match: ["s19"], vendor: "Bitmain", model: "Antminer S19", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 95 },
  { match: ["t19"], vendor: "Bitmain", model: "Antminer T19", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 84 },
  { match: ["s17"], vendor: "Bitmain", model: "Antminer S17", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 56 },
  { match: ["s9"], vendor: "Bitmain", model: "Antminer S9", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 14 },
  // Bitmain — other algorithms
  { match: ["l7"], vendor: "Bitmain", model: "Antminer L7", algo: "Scrypt", cooling: "air", boards: 3 },
  { match: ["ks5"], vendor: "Bitmain", model: "Antminer KS5", algo: "kHeavyHash", cooling: "air", boards: 3 },
  { match: ["ks3"], vendor: "Bitmain", model: "Antminer KS3", algo: "kHeavyHash", cooling: "air", boards: 3 },
  { match: ["z15"], vendor: "Bitmain", model: "Antminer Z15", algo: "Equihash", cooling: "air", boards: 3 },
  { match: ["d9"], vendor: "Bitmain", model: "Antminer D9", algo: "X11", cooling: "air", boards: 3 },
  // —— MicroBT Whatsminer (SHA-256) ——
  { match: ["m66", "s"], vendor: "MicroBT", model: "Whatsminer M66S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 298 },
  { match: ["m66"], vendor: "MicroBT", model: "Whatsminer M66", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 280 },
  { match: ["m63", "s"], vendor: "MicroBT", model: "Whatsminer M63S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 390 },
  { match: ["m63"], vendor: "MicroBT", model: "Whatsminer M63", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 334 },
  { match: ["m60", "s"], vendor: "MicroBT", model: "Whatsminer M60S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 186 },
  { match: ["m60"], vendor: "MicroBT", model: "Whatsminer M60", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 172 },
  { match: ["m56", "s"], vendor: "MicroBT", model: "Whatsminer M56S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 212 },
  { match: ["m56"], vendor: "MicroBT", model: "Whatsminer M56", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 194 },
  { match: ["m53", "s"], vendor: "MicroBT", model: "Whatsminer M53S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 260 },
  { match: ["m53"], vendor: "MicroBT", model: "Whatsminer M53", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 226 },
  { match: ["m50", "s"], vendor: "MicroBT", model: "Whatsminer M50S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 126 },
  { match: ["m50"], vendor: "MicroBT", model: "Whatsminer M50", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 114 },
  { match: ["m30s++"], vendor: "MicroBT", model: "Whatsminer M30S++", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 112 },
  { match: ["m30s+"], vendor: "MicroBT", model: "Whatsminer M30S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 100 },
  { match: ["m30s"], vendor: "MicroBT", model: "Whatsminer M30S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 88 },
  { match: ["m31s"], vendor: "MicroBT", model: "Whatsminer M31S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 76 },
  { match: ["m20s"], vendor: "MicroBT", model: "Whatsminer M20S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 68 },
  // —— Canaan Avalon (SHA-256) ——
  { match: ["a15"], vendor: "Canaan", model: "Avalon A15", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 194 },
  { match: ["a1466"], vendor: "Canaan", model: "Avalon A1466", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 150 },
  { match: ["a1366"], vendor: "Canaan", model: "Avalon A1366", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 130 },
  { match: ["a1246"], vendor: "Canaan", model: "Avalon A1246", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 90 },
  { match: ["avalon"], vendor: "Canaan", model: "Avalon", algo: "SHA-256", cooling: "air", boards: 4 },
];

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/antminer|bitmain|whatsminer|microbt|canaan|avalonminer/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Identify a miner from its model string. Returns a known spec, or a best-effort
 * guess (vendor + cooling inferred from the name) when the exact model isn't in
 * the catalog — so a never-seen model still gets correct cooling handling.
 */
export function lookupSpec(model: string | undefined | null): DeviceSpec | null {
  if (!model) return null;
  const n = norm(model);
  if (!n) return null;
  for (const e of CATALOG) {
    if (e.match.every((kw) => n.includes(kw))) {
      const { match: _m, ...spec } = e;
      void _m;
      return spec;
    }
  }
  // Unknown model: infer cooling from the name so fan handling stays correct.
  const cooling: Cooling = /hyd/.test(n) ? "hydro" : /imm/.test(n) ? "immersion" : "air";
  const vendor = /whatsminer|microbt|^m\d/.test(n)
    ? "MicroBT"
    : /avalon/.test(n)
      ? "Canaan"
      : /antminer|^[std]\d/.test(n)
        ? "Bitmain"
        : "غير معروف";
  return { vendor, model: model.trim(), algo: "SHA-256", cooling, boards: 3 };
}
