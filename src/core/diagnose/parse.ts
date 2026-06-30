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

const numbered = (raw: string, prefix: string): Map<number, number> => {
  const out = new Map<number, number>();
  const re = new RegExp(`"${prefix}(\\d+)"\\s*:\\s*"?(-?[\\d.]+)`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) out.set(Number(m[1]), Number(m[2]) || 0);
  return out;
};

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

  const issues: HealthIssue[] = [];
  const maxRate = Math.max(0, ...boards.map((b) => b.rateGhs));
  const maxChips = Math.max(0, ...boards.map((b) => b.chips));

  for (const b of boards) {
    // Board enumerated chips but isn't hashing → genuine failure.
    if (b.chips > 0 && maxRate > 0 && b.rateGhs < maxRate * 0.05) {
      issues.push({ code: "boardDown", severity: "high", values: { board: b.board } });
    } else if (maxChips > 0 && b.chips > 0 && b.chips < maxChips * 0.9) {
      // A working board missing a meaningful share of its chips.
      issues.push({
        code: "chipsMissing",
        severity: "warn",
        values: { board: b.board, chips: b.chips, expected: maxChips },
      });
    }
  }
  // Stopped fan — only meaningful on air-cooled units that have fans at all.
  if (hasFans) {
    const maxFan = Math.max(0, ...fans);
    fans.forEach((rpm, i) => {
      if (maxFan > 500 && rpm === 0) issues.push({ code: "fanDead", severity: "high", values: { fan: i + 1 } });
    });
  }
  // Overheating board.
  for (const tv of temps) {
    if (tv >= 95) {
      issues.push({ code: "boardHot", severity: "high", values: { temp: tv } });
      break;
    }
  }

  return { boards, fans, temps, hasFans, issues };
}
