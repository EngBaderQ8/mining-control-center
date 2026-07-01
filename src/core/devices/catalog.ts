export type Cooling = "air" | "hydro" | "immersion";

export interface DeviceSpec {
  vendor: string; // manufacturer
  model: string; // canonical model name
  algo: string; // mining algorithm
  cooling: Cooling;
  boards: number; // hashboard count (typical) — display metadata; diagnostics use live board data
  nominalTHs?: number; // approx rated hashrate (TH/s for SHA-256)
  jPerTh?: number; // rated WALL efficiency (J/TH) — for accurate per-model power/cost
}

interface CatalogEntry extends DeviceSpec {
  // lowercase keyword groups; ALL must appear in the normalized model string.
  match: string[];
}

// Comprehensive reference of SHA-256 (BTC) ASIC miners + a few common altcoin rigs.
// Each vendor group is ordered MOST-SPECIFIC FIRST (more keywords, then longer keyword
// string) so longer model names win — e.g. "a1566" before "a15", "s21e" before "s21",
// "m66s" before "m66". cooling drives false-alarm-free diagnostics; jPerTh drives
// accurate per-model power/electricity so a mixed-model site is costed correctly.
const CATALOG: CatalogEntry[] = [
// —— Bitmain Antminer (SHA-256) ——
  { match: ["s19", "pro+", "hyd"], vendor: "Bitmain", model: "Antminer S19 Pro+ Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 198, jPerTh: 27.3 },
  { match: ["s21e", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S21e XP Hydro 3U", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 860, jPerTh: 11.5 },
  { match: ["s19", "pro", "hyd"], vendor: "Bitmain", model: "Antminer S19 Pro Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 184, jPerTh: 29.5 },
  { match: ["s21", "xp", "imm"], vendor: "Bitmain", model: "Antminer S21 XP Immersion", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 300, jPerTh: 12 },
  { match: ["s21", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S21 XP Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 473, jPerTh: 12 },
  { match: ["s19", "xp", "hyd"], vendor: "Bitmain", model: "Antminer S19 XP Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 257, jPerTh: 20.8 },
  { match: ["s19j", "pro+"], vendor: "Bitmain", model: "Antminer S19j Pro+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 122, jPerTh: 27.5 },
  { match: ["s21e", "hyd"], vendor: "Bitmain", model: "Antminer S21e XP Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 430, jPerTh: 11.5 },
  { match: ["s21+", "hyd"], vendor: "Bitmain", model: "Antminer S21+ Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 319, jPerTh: 15 },
  { match: ["s19k", "pro"], vendor: "Bitmain", model: "Antminer S19k Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 120, jPerTh: 23 },
  { match: ["s19j", "pro"], vendor: "Bitmain", model: "Antminer S19j Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 104, jPerTh: 29.5 },
  { match: ["s19a", "pro"], vendor: "Bitmain", model: "Antminer S19a Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 110, jPerTh: 29.5 },
  { match: ["s21", "hyd"], vendor: "Bitmain", model: "Antminer S21 Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 335, jPerTh: 16 },
  { match: ["s21", "pro"], vendor: "Bitmain", model: "Antminer S21 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 234, jPerTh: 15 },
  { match: ["s19", "hyd"], vendor: "Bitmain", model: "Antminer S19 Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 158, jPerTh: 34.2 },
  { match: ["s19", "pro"], vendor: "Bitmain", model: "Antminer S19 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 110, jPerTh: 29.5 },
  { match: ["s17", "pro"], vendor: "Bitmain", model: "Antminer S17 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 53, jPerTh: 39.5 },
  { match: ["s21", "xp"], vendor: "Bitmain", model: "Antminer S21 XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 270, jPerTh: 13.5 },
  { match: ["s19", "xp"], vendor: "Bitmain", model: "Antminer S19 XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 141, jPerTh: 21.5 },
  { match: ["s9", "se"], vendor: "Bitmain", model: "Antminer S9 SE", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 16, jPerTh: 81 },
  { match: ["s21e"], vendor: "Bitmain", model: "Antminer S21e", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 204, jPerTh: 17 },
  { match: ["s21+"], vendor: "Bitmain", model: "Antminer S21+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 225, jPerTh: 16.5 },
  { match: ["s19j"], vendor: "Bitmain", model: "Antminer S19j", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 90, jPerTh: 34.5 },
  { match: ["s19a"], vendor: "Bitmain", model: "Antminer S19a", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 96, jPerTh: 34.5 },
  { match: ["s17+"], vendor: "Bitmain", model: "Antminer S17+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 73, jPerTh: 40 },
  { match: ["s17e"], vendor: "Bitmain", model: "Antminer S17e", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 64, jPerTh: 45 },
  { match: ["t17+"], vendor: "Bitmain", model: "Antminer T17+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 64, jPerTh: 50 },
  { match: ["t17e"], vendor: "Bitmain", model: "Antminer T17e", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 53, jPerTh: 55 },
  { match: ["s21"], vendor: "Bitmain", model: "Antminer S21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 200, jPerTh: 17.5 },
  { match: ["t21"], vendor: "Bitmain", model: "Antminer T21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 190, jPerTh: 19 },
  { match: ["s19"], vendor: "Bitmain", model: "Antminer S19", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 95, jPerTh: 34.5 },
  { match: ["t19"], vendor: "Bitmain", model: "Antminer T19", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 84, jPerTh: 37.5 },
  { match: ["s17"], vendor: "Bitmain", model: "Antminer S17", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 56, jPerTh: 45 },
  { match: ["t17"], vendor: "Bitmain", model: "Antminer T17", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 40, jPerTh: 55 },
  { match: ["s15"], vendor: "Bitmain", model: "Antminer S15", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 28, jPerTh: 57 },
  { match: ["s11"], vendor: "Bitmain", model: "Antminer S11", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 20.5, jPerTh: 73 },
  { match: ["s9k"], vendor: "Bitmain", model: "Antminer S9k", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 14, jPerTh: 100 },
  { match: ["s9j"], vendor: "Bitmain", model: "Antminer S9j", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 14.5, jPerTh: 102 },
  { match: ["s9i"], vendor: "Bitmain", model: "Antminer S9i", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 14, jPerTh: 100 },
  { match: ["s9"], vendor: "Bitmain", model: "Antminer S9", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 13.5, jPerTh: 98 },
  // Bitmain — other algorithms (cooling/vendor only)
  { match: ["l7"], vendor: "Bitmain", model: "Antminer L7", algo: "Scrypt", cooling: "air", boards: 3 },
  { match: ["ks5"], vendor: "Bitmain", model: "Antminer KS5", algo: "kHeavyHash", cooling: "air", boards: 3 },
  { match: ["ks3"], vendor: "Bitmain", model: "Antminer KS3", algo: "kHeavyHash", cooling: "air", boards: 3 },
  { match: ["z15"], vendor: "Bitmain", model: "Antminer Z15", algo: "Equihash", cooling: "air", boards: 3 },
  { match: ["d9"], vendor: "Bitmain", model: "Antminer D9", algo: "X11", cooling: "air", boards: 3 },
  // —— MicroBT Whatsminer (SHA-256) ——
  { match: ["m66s++"], vendor: "MicroBT", model: "Whatsminer M66S++", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 338, jPerTh: 16 },
  { match: ["m63s++"], vendor: "MicroBT", model: "Whatsminer M63S++", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 424, jPerTh: 16 },
  { match: ["m60s++"], vendor: "MicroBT", model: "Whatsminer M60S++", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 226, jPerTh: 15.9 },
  { match: ["m56s++"], vendor: "MicroBT", model: "Whatsminer M56S++", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 254, jPerTh: 22 },
  { match: ["m53s++"], vendor: "MicroBT", model: "Whatsminer M53S++", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 320, jPerTh: 22 },
  { match: ["m50s++"], vendor: "MicroBT", model: "Whatsminer M50S++", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 158, jPerTh: 22 },
  { match: ["m33s++"], vendor: "MicroBT", model: "Whatsminer M33S++", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 242, jPerTh: 30 },
  { match: ["m30s++"], vendor: "MicroBT", model: "Whatsminer M30S++", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 112, jPerTh: 31 },
  { match: ["m70s+"], vendor: "MicroBT", model: "Whatsminer M70S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 244, jPerTh: 12.9 },
  { match: ["m66s+"], vendor: "MicroBT", model: "Whatsminer M66S+", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 324, jPerTh: 16 },
  { match: ["m63s+"], vendor: "MicroBT", model: "Whatsminer M63S+", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 406, jPerTh: 16 },
  { match: ["m60s+"], vendor: "MicroBT", model: "Whatsminer M60S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 190, jPerTh: 17 },
  { match: ["m56s+"], vendor: "MicroBT", model: "Whatsminer M56S+", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 230, jPerTh: 24.1 },
  { match: ["m53s+"], vendor: "MicroBT", model: "Whatsminer M53S+", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 300, jPerTh: 23 },
  { match: ["m50s+"], vendor: "MicroBT", model: "Whatsminer M50S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 150, jPerTh: 24 },
  { match: ["m33s+"], vendor: "MicroBT", model: "Whatsminer M33S+", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 220, jPerTh: 33 },
  { match: ["m31s+"], vendor: "MicroBT", model: "Whatsminer M31S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 80, jPerTh: 42 },
  { match: ["m30s+"], vendor: "MicroBT", model: "Whatsminer M30S+", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 100, jPerTh: 34 },
  { match: ["m70s"], vendor: "MicroBT", model: "Whatsminer M70S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 226, jPerTh: 13.9 },
  { match: ["m66s"], vendor: "MicroBT", model: "Whatsminer M66S", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 298, jPerTh: 18.5 },
  { match: ["m63s"], vendor: "MicroBT", model: "Whatsminer M63S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 390, jPerTh: 18.5 },
  { match: ["m60s"], vendor: "MicroBT", model: "Whatsminer M60S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 186, jPerTh: 18.5 },
  { match: ["m56s"], vendor: "MicroBT", model: "Whatsminer M56S", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 212, jPerTh: 26.2 },
  { match: ["m53s"], vendor: "MicroBT", model: "Whatsminer M53S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 260, jPerTh: 26 },
  { match: ["m50s"], vendor: "MicroBT", model: "Whatsminer M50S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 128, jPerTh: 26 },
  { match: ["m33s"], vendor: "MicroBT", model: "Whatsminer M33S", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 196, jPerTh: 35 },
  { match: ["m32s"], vendor: "MicroBT", model: "Whatsminer M32S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 66, jPerTh: 52 },
  { match: ["m31s"], vendor: "MicroBT", model: "Whatsminer M31S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 76, jPerTh: 42 },
  { match: ["m30s"], vendor: "MicroBT", model: "Whatsminer M30S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 86, jPerTh: 38 },
  { match: ["m21s"], vendor: "MicroBT", model: "Whatsminer M21S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 56, jPerTh: 60 },
  { match: ["m20s"], vendor: "MicroBT", model: "Whatsminer M20S", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 68, jPerTh: 48 },
  { match: ["m70"], vendor: "MicroBT", model: "Whatsminer M70", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 214, jPerTh: 14.7 },
  { match: ["m66"], vendor: "MicroBT", model: "Whatsminer M66", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 289, jPerTh: 18.5 },
  { match: ["m63"], vendor: "MicroBT", model: "Whatsminer M63", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 366, jPerTh: 18.5 },
  { match: ["m60"], vendor: "MicroBT", model: "Whatsminer M60", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 172, jPerTh: 18.5 },
  { match: ["m56"], vendor: "MicroBT", model: "Whatsminer M56", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 194, jPerTh: 28.6 },
  { match: ["m53"], vendor: "MicroBT", model: "Whatsminer M53", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 230, jPerTh: 29 },
  { match: ["m50"], vendor: "MicroBT", model: "Whatsminer M50", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 114, jPerTh: 29 },
  { match: ["m33"], vendor: "MicroBT", model: "Whatsminer M33", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 88, jPerTh: 38 },
  { match: ["m32"], vendor: "MicroBT", model: "Whatsminer M32", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 62, jPerTh: 54 },
  { match: ["m31"], vendor: "MicroBT", model: "Whatsminer M31", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 70, jPerTh: 47 },
  { match: ["m30"], vendor: "MicroBT", model: "Whatsminer M30", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 78, jPerTh: 45 },
  { match: ["m21"], vendor: "MicroBT", model: "Whatsminer M21", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 31, jPerTh: 60 },
  { match: ["m20"], vendor: "MicroBT", model: "Whatsminer M20", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 65, jPerTh: 50 },
  // —— Canaan Avalon (SHA-256) ——
  { match: ["a1166", "pro"], vendor: "Canaan", model: "AvalonMiner A1166 Pro", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 81, jPerTh: 42 },
  { match: ["a1146", "pro"], vendor: "Canaan", model: "AvalonMiner A1146 Pro", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 63, jPerTh: 52 },
  { match: ["a1126", "pro"], vendor: "Canaan", model: "AvalonMiner A1126 Pro", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 68, jPerTh: 50 },
  { match: ["avalon", "q"], vendor: "Canaan", model: "Avalon Q (90Th)", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 90, jPerTh: 18.6 },
  { match: ["a15", "pro"], vendor: "Canaan", model: "Avalon A15 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 218, jPerTh: 16.8 },
  { match: ["nano", "3s"], vendor: "Canaan", model: "Avalon Nano 3S (6Th)", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 6, jPerTh: 23.3 },
  { match: ["mini", "3"], vendor: "Canaan", model: "Avalon Mini 3 (37.5Th)", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 37.5, jPerTh: 21.3 },
  { match: ["nano", "3"], vendor: "Canaan", model: "Avalon Nano 3 (4Th)", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 4, jPerTh: 35 },
  { match: ["a1566i"], vendor: "Canaan", model: "Avalon A1566I (Immersion)", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 249, jPerTh: 18.7 },
  { match: ["a1466i"], vendor: "Canaan", model: "Avalon A1466I (Immersion)", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 170, jPerTh: 19.5 },
  { match: ["a1366i"], vendor: "Canaan", model: "Avalon A1366I (Immersion)", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 119, jPerTh: 30 },
  { match: ["a1346i"], vendor: "Canaan", model: "Avalon A1346I (Immersion)", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 104, jPerTh: 31.7 },
  { match: ["a1246i"], vendor: "Canaan", model: "AvalonMiner A1246I (Immersion)", algo: "SHA-256", cooling: "immersion", boards: 4, nominalTHs: 93, jPerTh: 36 },
  { match: ["a15xp"], vendor: "Canaan", model: "Avalon A15XP", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 206, jPerTh: 17.8 },
  { match: ["a15se"], vendor: "Canaan", model: "Avalon A15SE", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 180, jPerTh: 19.9 },
  { match: ["a1566"], vendor: "Canaan", model: "Avalon A1566", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 185, jPerTh: 18.5 },
  { match: ["a1466"], vendor: "Canaan", model: "Avalon A1466", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 150, jPerTh: 21.5 },
  { match: ["a1446"], vendor: "Canaan", model: "Avalon A1446", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 135, jPerTh: 24.5 },
  { match: ["a1366"], vendor: "Canaan", model: "Avalon A1366", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 130, jPerTh: 25 },
  { match: ["a1346"], vendor: "Canaan", model: "Avalon A1346", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 110, jPerTh: 30 },
  { match: ["a1266"], vendor: "Canaan", model: "Avalon A1266", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 100, jPerTh: 35 },
  { match: ["a1246"], vendor: "Canaan", model: "AvalonMiner A1246", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 90, jPerTh: 38 },
  { match: ["a1166"], vendor: "Canaan", model: "AvalonMiner A1166", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 68, jPerTh: 47 },
  { match: ["a1146"], vendor: "Canaan", model: "AvalonMiner A1146", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 56, jPerTh: 59 },
  { match: ["a1066"], vendor: "Canaan", model: "AvalonMiner A1066", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 50, jPerTh: 65 },
  { match: ["a1047"], vendor: "Canaan", model: "AvalonMiner A1047", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 37, jPerTh: 64 },
  { match: ["a1026"], vendor: "Canaan", model: "AvalonMiner A1026", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 30, jPerTh: 73 },
  { match: ["a921"], vendor: "Canaan", model: "AvalonMiner A921", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 20, jPerTh: 85 },
  { match: ["a911"], vendor: "Canaan", model: "AvalonMiner A911", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 19.5, jPerTh: 97 },
  { match: ["a852"], vendor: "Canaan", model: "AvalonMiner A852", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 15, jPerTh: 96 },
  { match: ["a851"], vendor: "Canaan", model: "AvalonMiner A851", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 14.5, jPerTh: 94 },
  { match: ["a841"], vendor: "Canaan", model: "AvalonMiner A841", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 13.6, jPerTh: 95 },
  { match: ["a821"], vendor: "Canaan", model: "AvalonMiner A821", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 11.5, jPerTh: 104 },
  { match: ["a741"], vendor: "Canaan", model: "AvalonMiner A741", algo: "SHA-256", cooling: "air", boards: 4, nominalTHs: 7.3, jPerTh: 158 },
  { match: ["a15"], vendor: "Canaan", model: "Avalon A15", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 194, jPerTh: 18.8 },
  // —— Bitdeer SEALMINER (SHA-256) ——
  { match: ["sealminer", "a4", "ultra", "hydro"], vendor: "Bitdeer", model: "SEALMINER A4 Ultra Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 886, jPerTh: 9.4 },
  { match: ["sealminer", "a4", "pro", "hydro"], vendor: "Bitdeer", model: "SEALMINER A4 Pro Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 680, jPerTh: 10.9 },
  { match: ["sealminer", "a3", "pro", "hydro"], vendor: "Bitdeer", model: "SEALMINER A3 Pro Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 660, jPerTh: 12.5 },
  { match: ["sealminer", "a2", "pro", "hydro"], vendor: "Bitdeer", model: "SEALMINER A2 Pro Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 500, jPerTh: 14.9 },
  { match: ["sealminer", "a4", "pro", "air"], vendor: "Bitdeer", model: "SEALMINER A4 Pro Air", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 336, jPerTh: 10.9 },
  { match: ["sealminer", "a3", "pro", "air"], vendor: "Bitdeer", model: "SEALMINER A3 Pro Air", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 290, jPerTh: 12.5 },
  { match: ["sealminer", "a2", "pro", "air"], vendor: "Bitdeer", model: "SEALMINER A2 Pro Air", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 255, jPerTh: 14.9 },
  { match: ["sealminer", "a4", "hydro"], vendor: "Bitdeer", model: "SEALMINER A4 Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 680, jPerTh: 10.9 },
  { match: ["sealminer", "a3", "hydro"], vendor: "Bitdeer", model: "SEALMINER A3 Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 500, jPerTh: 13.5 },
  { match: ["sealminer", "a2", "hydro"], vendor: "Bitdeer", model: "SEALMINER A2 Hydro", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 446, jPerTh: 16.5 },
  { match: ["sealminer", "a4", "pro"], vendor: "Bitdeer", model: "SEALMINER A4 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 336, jPerTh: 10.9 },
  { match: ["sealminer", "a3", "pro"], vendor: "Bitdeer", model: "SEALMINER A3 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 290, jPerTh: 12.5 },
  { match: ["sealminer", "a3", "air"], vendor: "Bitdeer", model: "SEALMINER A3 Air", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 260, jPerTh: 14 },
  { match: ["sealminer", "a2", "pro"], vendor: "Bitdeer", model: "SEALMINER A2 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 255, jPerTh: 14.9 },
  { match: ["sealminer", "a2", "air"], vendor: "Bitdeer", model: "SEALMINER A2 Air", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 226, jPerTh: 16.5 },
  { match: ["sealminer", "a1", "pro"], vendor: "Bitdeer", model: "SEALMINER A1 Pro", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 226, jPerTh: 18.1 },
  { match: ["sealminer", "a4"], vendor: "Bitdeer", model: "SEALMINER A4", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 336, jPerTh: 10.9 },
  { match: ["sealminer", "a3"], vendor: "Bitdeer", model: "SEALMINER A3", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 260, jPerTh: 14 },
  { match: ["sealminer", "a2"], vendor: "Bitdeer", model: "SEALMINER A2", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 226, jPerTh: 16.5 },
  { match: ["sealminer", "a1"], vendor: "Bitdeer", model: "SEALMINER A1", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 194, jPerTh: 20.5 },
  // —— Other brands (Auradine, ePIC) SHA-256 ——
  { match: ["teraflux", "ah3880"], vendor: "Auradine", model: "Auradine Teraflux AH3880", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 600, jPerTh: 14.5 },
  { match: ["teraflux", "ai3680"], vendor: "Auradine", model: "Auradine Teraflux AI3680", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 375, jPerTh: 15 },
  { match: ["teraflux", "at2880"], vendor: "Auradine", model: "Auradine Teraflux AT2880", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 260, jPerTh: 16 },
  { match: ["blockminer", "740a"], vendor: "ePIC", model: "ePIC BlockMiner 740a", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 145, jPerTh: 34 },
  { match: ["blockminer", "520i"], vendor: "ePIC", model: "ePIC BlockMiner 520i", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 112, jPerTh: 33 },
  { match: ["blockminer", "520"], vendor: "ePIC", model: "ePIC BlockMiner 520", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 112, jPerTh: 33 },
  { match: ["teraflux", "ah"], vendor: "Auradine", model: "Auradine Teraflux AH Series (Hydro)", algo: "SHA-256", cooling: "hydro", boards: 3, nominalTHs: 600, jPerTh: 14.5 },
  { match: ["teraflux", "ai"], vendor: "Auradine", model: "Auradine Teraflux AI Series (Immersion)", algo: "SHA-256", cooling: "immersion", boards: 3, nominalTHs: 375, jPerTh: 15 },
  { match: ["teraflux", "at"], vendor: "Auradine", model: "Auradine Teraflux AT Series (Air)", algo: "SHA-256", cooling: "air", boards: 3, nominalTHs: 260, jPerTh: 16 },
  // Generic fallback (must stay LAST): any bare "Avalon" not matched above.
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
