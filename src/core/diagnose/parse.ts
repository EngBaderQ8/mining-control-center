export interface BoardHealth {
  board: number;
  chips: number; // active chips on this chain
  rateGhs: number; // hashrate of this chain (GH/s)
  hwErrors: number;
}

export type IssueCode = "boardDown" | "chipsMissing" | "fanDead" | "highHwErrors" | "boardHot";
export interface HealthIssue {
  code: IssueCode;
  severity: "warn" | "high";
  values: Record<string, number>;
}

export interface DeviceHealth {
  boards: BoardHealth[];
  fans: number[];
  temps: number[];
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
 * Diagnose a device from its raw cgminer `stats` reply: per-board hashrate/chips/
 * errors, fans, temps — and the concrete faults (a dead board, missing chips, a
 * stopped fan, high hardware errors, an overheating board). Lenient/regex-based,
 * so it tolerates the slightly-malformed JSON Antminer emits.
 */
export function parseDeviceHealth(raw: string): DeviceHealth {
  const acn = numbered(raw, "chain_acn");
  const rate = numbered(raw, "chain_rate");
  const hw = numbered(raw, "chain_hw");
  const fanMap = numbered(raw, "fan");
  const tempMap = numbered(raw, "temp");

  const boardIdx = [...new Set([...acn.keys(), ...rate.keys(), ...hw.keys()])].sort((a, b) => a - b);
  const boards: BoardHealth[] = boardIdx.map((b) => ({
    board: b,
    chips: acn.get(b) ?? 0,
    rateGhs: rate.get(b) ?? 0,
    hwErrors: hw.get(b) ?? 0,
  }));
  // Fans: keys like fan1..fanN (ignore fan_num which numbered() won't match since
  // it has no trailing digit after the word "fan" — "fan_num" → prefix "fan" + "_num"? no).
  const fans = [...fanMap.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const temps = [...tempMap.values()].filter((x) => x > 0 && x < 200);

  const issues: HealthIssue[] = [];
  const maxRate = Math.max(0, ...boards.map((b) => b.rateGhs));
  const maxChips = Math.max(0, ...boards.map((b) => b.chips));

  for (const b of boards) {
    // Dead board: produces no hashrate while at least one other board works.
    if (maxRate > 0 && b.rateGhs < maxRate * 0.05) {
      issues.push({ code: "boardDown", severity: "high", values: { board: b.board } });
    } else if (maxChips > 0 && b.chips > 0 && b.chips < maxChips * 0.9) {
      // Missing chips on an otherwise-working board.
      issues.push({
        code: "chipsMissing",
        severity: "warn",
        values: { board: b.board, chips: b.chips, expected: maxChips },
      });
    }
  }
  // Stopped fan while others spin.
  const maxFan = Math.max(0, ...fans);
  fans.forEach((rpm, i) => {
    if (maxFan > 500 && rpm === 0) issues.push({ code: "fanDead", severity: "high", values: { fan: i + 1 } });
  });
  // High hardware-error rate per board (errors relative to its size).
  for (const b of boards) {
    if (b.rateGhs > maxRate * 0.05 && b.hwErrors > 0 && b.chips > 0 && b.hwErrors / b.chips > 5) {
      issues.push({ code: "highHwErrors", severity: "warn", values: { board: b.board, errors: b.hwErrors } });
    }
  }
  // Overheating board.
  for (const tv of temps) {
    if (tv >= 95) {
      issues.push({ code: "boardHot", severity: "high", values: { temp: tv } });
      break;
    }
  }

  return { boards, fans, temps, issues };
}
