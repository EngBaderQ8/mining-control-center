export type Cooling = "air" | "hydro" | "immersion";

export interface DeviceSpec {
  vendor: string; // manufacturer
  model: string; // canonical model name
  algo: string; // mining algorithm
  cooling: Cooling;
  boards: number; // hashboard count (typical)
  nominalTHs?: number; // approx rated hashrate (TH/s for SHA-256; GH/s noted otherwise)
  jPerTh?: number; // rated WALL efficiency (J/TH) — for accurate per-model power/cost
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
  { match: ["s21", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S21 XP Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 473, jPerTh: 12 },
  { match: ["s21", "xp", "imm"], vendor: "Bitmain", model: "Antminer S21 XP Immersion", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 300, jPerTh: 13.5 },
  { match: ["s21", "xp"], vendor: "Bitmain", model: "Antminer S21 XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 270, jPerTh: 13.5 },
  { match: ["s21", "hyd"], vendor: "Bitmain", model: "Antminer S21 Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 335, jPerTh: 16 },
  { match: ["s21", "pro"], vendor: "Bitmain", model: "Antminer S21 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 234, jPerTh: 15 },
  { match: ["s21+", "hyd"], vendor: "Bitmain", model: "Antminer S21+ Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 358, jPerTh: 15 },
  { match: ["s21+"], vendor: "Bitmain", model: "Antminer S21+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 216, jPerTh: 15 },
  { match: ["s21"], vendor: "Bitmain", model: "Antminer S21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 200, jPerTh: 17.5 },
  { match: ["t21"], vendor: "Bitmain", model: "Antminer T21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 190, jPerTh: 19 },
  { match: ["s19", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S19 XP Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 257, jPerTh: 20.8 },
  { match: ["s19", "xp"], vendor: "Bitmain", model: "Antminer S19 XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 141, jPerTh: 21.5 },
  { match: ["s19", "pro+", "hyd"], vendor: "Bitmain", model: "Antminer S19 Pro+ Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 198, jPerTh: 27.5 },
  { match: ["s19j", "pro+"], vendor: "Bitmain", model: "Antminer S19j Pro+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 120, jPerTh: 27.5 },
  { match: ["s19j", "pro"], vendor: "Bitmain", model: "Antminer S19j Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 104, jPerTh: 29.5 },
  { match: ["s19k", "pro"], vendor: "Bitmain", model: "Antminer S19k Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 120, jPerTh: 23 },
  { match: ["s19", "pro", "hyd"], vendor: "Bitmain", model: "Antminer S19 Pro Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 177, jPerTh: 29.5 },
  { match: ["s19", "pro"], vendor: "Bitmain", model: "Antminer S19 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 110, jPerTh: 29.5 },
  { match: ["s19", "hyd"], vendor: "Bitmain", model: "Antminer S19 Hyd", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 158, jPerTh: 34.5 },
  { match: ["s19"], vendor: "Bitmain", model: "Antminer S19", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 95, jPerTh: 34.2 },
  { match: ["t19"], vendor: "Bitmain", model: "Antminer T19", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 84, jPerTh: 37.5 },
  { match: ["s17"], vendor: "Bitmain", model: "Antminer S17", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 56, jPerTh: 45 },
  { match: ["s9"], vendor: "Bitmain", model: "Antminer S9", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 14, jPerTh: 98 },
  // Bitmain — other algorithms
  { match: ["l7"], vendor: "Bitmain", model: "Antminer L7", algo: "Scrypt", cooling: "air", boards: 3 },
  { match: ["ks5"], vendor: "Bitmain", model: "Antminer KS5", algo: "kHeavyHash", cooling: "air", boards: 3 },
  { match: ["ks3"], vendor: "Bitmain", model: "Antminer KS3", algo: "kHeavyHash", cooling: "air", boards: 3 },
  { match: ["z15"], vendor: "Bitmain", model: "Antminer Z15", algo: "Equihash", cooling: "air", boards: 3 },
  { match: ["d9"], vendor: "Bitmain", model: "Antminer D9", algo: "X11", cooling: "air", boards: 3 },
  // —— MicroBT Whatsminer (SHA-256) ——
  { match: ["m66", "s"], vendor: "MicroBT", model: "Whatsminer M66S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 298, jPerTh: 18.5 },
  { match: ["m66"], vendor: "MicroBT", model: "Whatsminer M66", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 280, jPerTh: 19.9 },
  { match: ["m63", "s"], vendor: "MicroBT", model: "Whatsminer M63S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 390, jPerTh: 18.5 },
  { match: ["m63"], vendor: "MicroBT", model: "Whatsminer M63", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 334, jPerTh: 19.9 },
  { match: ["m60", "s"], vendor: "MicroBT", model: "Whatsminer M60S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 186, jPerTh: 18.5 },
  { match: ["m60"], vendor: "MicroBT", model: "Whatsminer M60", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 172, jPerTh: 19.9 },
  { match: ["m56", "s"], vendor: "MicroBT", model: "Whatsminer M56S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 212, jPerTh: 26.2 },
  { match: ["m56"], vendor: "MicroBT", model: "Whatsminer M56", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 194, jPerTh: 28.6 },
  { match: ["m53", "s"], vendor: "MicroBT", model: "Whatsminer M53S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 260, jPerTh: 26 },
  { match: ["m53"], vendor: "MicroBT", model: "Whatsminer M53", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 226, jPerTh: 29 },
  { match: ["m50", "s"], vendor: "MicroBT", model: "Whatsminer M50S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 126, jPerTh: 25.6 },
  { match: ["m50"], vendor: "MicroBT", model: "Whatsminer M50", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 114, jPerTh: 29 },
  { match: ["m30s++"], vendor: "MicroBT", model: "Whatsminer M30S++", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 112, jPerTh: 31 },
  { match: ["m30s+"], vendor: "MicroBT", model: "Whatsminer M30S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 100, jPerTh: 34 },
  { match: ["m30s"], vendor: "MicroBT", model: "Whatsminer M30S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 88, jPerTh: 38 },
  { match: ["m31s"], vendor: "MicroBT", model: "Whatsminer M31S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 76, jPerTh: 44 },
  { match: ["m20s"], vendor: "MicroBT", model: "Whatsminer M20S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 68, jPerTh: 49.4 },
  // —— Canaan Avalon (SHA-256) ——
  { match: ["a15"], vendor: "Canaan", model: "Avalon A15", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 194, jPerTh: 18.8 },
  { match: ["a1466"], vendor: "Canaan", model: "Avalon A1466", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 150, jPerTh: 21.5 },
  { match: ["a1366"], vendor: "Canaan", model: "Avalon A1366", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 130, jPerTh: 25 },
  { match: ["a1246"], vendor: "Canaan", model: "Avalon A1246", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 90, jPerTh: 38 },
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

/** Rated efficiency (J/TH) for a device by its model — the model's known spec value,
 *  or the provided fallback (the user's global setting) for models not in the catalog.
 *  Lets power/electricity be computed PER MODEL, so a mixed-model site is accurate. */
export function deviceJPerTh(model: string | undefined | null, fallback: number): number {
  const j = lookupSpec(model)?.jPerTh;
  return j !== undefined && j > 0 ? j : fallback;
}
