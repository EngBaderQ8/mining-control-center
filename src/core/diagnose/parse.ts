export interface BoardHealth {
  board: number;
  chips: number; // active chips on this chain
  rateGhs: number; // hashrate of this chain (GH/s)
  hwErrors: number; // CUMULATIVE lifetime HW errors — informational only, NOT a fault
}

export type IssueCode = "boardDown" | "chipsMissing" | "fanDead" | "boardHot";
export interface HealthIssue {
  code: IssueCode;
  severity: "warn" | "high";
  values: Record<string, number>;
}

export interface DeviceHealth {
  boards: BoardHealth[]; // only boards that actually exist (populated slots)
  fans: number[];
  temps: number[];
  hasFans: boolean; // false ⇒ water/immersion cooled (no fans is normal, not a fault)
  issues: HealthIssue[];
}

import { parseResponse } from "../cgminer/parse";

const numbered = (raw: string, prefix: string): Map<number, number> => {
  const out = new Map<number, number>();
  const re = new RegExp(`"${prefix}(\\d+)"\\s*:\\s*"?(-?[\\d.]+)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.set(Number(m[1]), Number(m[2]) || 0);
  return out;
};

/** Shared fault detection over already-extracted boards/fans/temps (same rules for
 *  every firmware): a board with chips but ~no hashrate is down; a working board
 *  missing chips is a warning; a stopped fan (only on air-cooled units) and a board
 *  ≥95° are faults. HW-error counts are cumulative and never flagged. */
function deriveIssues(
  boards: BoardHealth[],
  fans: number[],
  temps: number[],
  hasFans: boolean,
): HealthIssue[] {
  const issues: HealthIssue[] = [];
  const maxRate = Math.max(0, ...boards.map((b) => b.rateGhs));
  const maxChips = Math.max(0, ...boards.map((b) => b.chips));
  for (const b of boards) {
    if (b.chips > 0 && maxRate > 0 && b.rateGhs < maxRate * 0.05) {
      issues.push({ code: "boardDown", severity: "high", values: { board: b.board } });
    } else if (maxChips > 0 && b.chips > 0 && b.chips < maxChips * 0.9) {
      issues.push({
        code: "chipsMissing",
        severity: "warn",
        values: { board: b.board, chips: b.chips, expected: maxChips },
      });
    }
  }
  if (hasFans) {
    const maxFan = Math.max(0, ...fans);
    fans.forEach((rpm, i) => {
      if (maxFan > 500 && rpm === 0) issues.push({ code: "fanDead", severity: "high", values: { fan: i + 1 } });
    });
  }
  for (const tv of temps) {
    if (tv >= 95) {
      issues.push({ code: "boardHot", severity: "high", values: { temp: tv } });
      break;
    }
  }
  return issues;
}

/** Read the first finite number among candidate keys of an object (0 if none). */
function pickNum(o: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    if (o[k] !== undefined && o[k] !== null) {
      const n = Number(o[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

/**
 * Diagnose a Whatsminer (MicroBT/btminer) from its `edevs`/`devs` per-board reply +
 * `summary`. Whatsminer uses a completely different schema than cgminer: a DEVS/EDEVS
 * array (per board: `MHS av` in MH/s, `Temperature`/`Chip Temp Max`, `Effective Chips`)
 * and fans in `summary` (`Fan Speed In`/`Out`). Lenient on field names so it degrades
 * gracefully (a board still shows with just its hashrate + temp if the chip-count key
 * differs). `parseDeviceHealth`'s cgminer field names never match Whatsminer, hence
 * this dedicated parser.
 */
export function parseWhatsminerHealth(devsRaw: string, summaryRaw: string): DeviceHealth {
  const dres = parseResponse(devsRaw);
  const devs =
    dres.ok && (Array.isArray((dres.value as { DEVS?: unknown }).DEVS) ||
      Array.isArray((dres.value as { EDEVS?: unknown }).EDEVS))
      ? (((dres.value as { DEVS?: unknown }).DEVS ?? (dres.value as { EDEVS?: unknown }).EDEVS) as Array<
          Record<string, unknown>
        >)
      : [];

  const temps: number[] = [];
  const boardsAll: BoardHealth[] = devs.map((d, i) => {
    const board = pickNum(d, ["ASC", "ID", "Slot", "Index"]) || i;
    const rateGhs =
      d["GHS av"] !== undefined
        ? Number(d["GHS av"]) || 0
        : pickNum(d, ["MHS av", "MHS 5s", "MHS 1m"]) / 1000; // MH/s → GH/s
    const chips = pickNum(d, [
      "Effective Chips",
      "Chip Number",
      "Chips",
      "Effective Chip",
      "Number of Active Chips",
    ]);
    const temp = pickNum(d, ["Chip Temp Max", "Temperature", "Chip Temp Avg", "Temp"]);
    if (temp > 0 && temp < 200) temps.push(temp);
    return { board, chips, rateGhs, hwErrors: pickNum(d, ["Hardware Errors", "HW"]) };
  });
  // Drop empty/unpopulated slots (no chips and no hashrate).
  const boards = boardsAll.filter((b) => b.chips > 0 || b.rateGhs > 1);

  const sres = parseResponse(summaryRaw);
  const srow =
    sres.ok && Array.isArray((sres.value as { SUMMARY?: unknown }).SUMMARY)
      ? ((sres.value as { SUMMARY: Array<Record<string, unknown>> }).SUMMARY[0] ?? {})
      : {};
  const fans = ["Fan Speed In", "Fan Speed Out"].map((k) => Number(srow[k]) || 0);
  const hasFans = fans.some((f) => f > 0);

  const issues = deriveIssues(boards, fans, temps, hasFans);
  return { boards, fans: hasFans ? fans : [], temps, hasFans, issues };
}

/**
 * Diagnose a device from its raw cgminer `stats` reply. Designed to AVOID false
 * alarms on healthy miners:
 *  - A 0-chip / 0-hashrate chain is an UNPOPULATED slot (devices ship with 3 or 4
 *    boards), not a failed board — it's ignored, not flagged.
 *  - A board is "down" only when it HAS chips but produces ~no hashrate (enumerated
 *    but not hashing) — a genuine failure.
 *  - HW-error counts are cumulative lifetime counters (thousands is normal on a
 *    healthy unit), so they are shown for info but NEVER flagged as a fault.
 *  - A stopped fan is flagged only on devices that actually have fans; water/
 *    immersion-cooled miners report all-zero fans, which is normal.
 */
export function parseDeviceHealth(raw: string): DeviceHealth {
  const acn = numbered(raw, "chain_acn");
  const rate = numbered(raw, "chain_rate");
  const hw = numbered(raw, "chain_hw");
  const fanMap = numbered(raw, "fan");
  const tempMap = numbered(raw, "temp");

  const boardIdx = [...new Set([...acn.keys(), ...rate.keys(), ...hw.keys()])].sort((a, b) => a - b);
  const allBoards: BoardHealth[] = boardIdx.map((b) => ({
    board: b,
    chips: acn.get(b) ?? 0,
    rateGhs: rate.get(b) ?? 0,
    hwErrors: hw.get(b) ?? 0,
  }));
  // Keep only boards that actually exist (report chips or hashrate). Empty 0/0
  // slots are not failures — a device may simply have fewer boards.
  const boards = allBoards.filter((b) => b.chips > 0 || b.rateGhs > 1);

  const fans = [...fanMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const hasFans = fans.some((f) => f > 0);
  const temps = [...tempMap.values()].filter((x) => x > 0 && x < 200);

  const issues = deriveIssues(boards, fans, temps, hasFans);
  return { boards, fans, temps, hasFans, issues };
}
