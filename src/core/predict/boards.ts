import type { DeviceSample, BoardSnap, RiskLevel } from "./analyze";

export type BoardReasonCode = "chipsLost" | "boardRateDecline" | "hwErrorsClimbing" | "boardIntermittent";

export interface BoardReason {
  code: BoardReasonCode;
  values: Record<string, number>;
}

export interface BoardPrediction {
  board: number;
  severity: RiskLevel;
  reasons: BoardReason[];
  etaDays?: number; // forecast days until this board's hashrate crosses "dead" (½ of baseline)
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Least-squares slope of y vs time, in units per hour. */
function slopePerHour(pts: Array<{ t: number; y: number }>): number {
  const n = pts.length;
  if (n < 3) return 0;
  const t0 = pts[0]!.t;
  const xs = pts.map((p) => (p.t - t0) / 3_600_000);
  const ys = pts.map((p) => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

type PresentPt = { t: number; snap: BoardSnap };

/**
 * Predict which hashboards are DEGRADING before they fully die, from a device's
 * per-board history: chips silently dropping, this board's hashrate sliding vs its
 * own earlier baseline (with a rough ETA), a climbing HW-error rate, or a board that
 * keeps dropping out. A fully-dead, stays-offline board is already flagged elsewhere
 * (device hashrate drop + diagnostics), so this focuses on the slow decline that
 * humans miss. Returns [] for a healthy fleet.
 */
export function analyzeBoards(samples: DeviceSample[]): BoardPrediction[] {
  const withB = samples.filter(
    (s): s is DeviceSample & { boards: BoardSnap[] } => s.online && !!s.boards && s.boards.length > 0,
  );
  if (withB.length < 5) return [];

  const boardNums = new Set<number>();
  for (const s of withB) for (const b of s.boards) boardNums.add(b.b);

  const out: BoardPrediction[] = [];

  for (const bn of boardNums) {
    const series = withB.map((s) => ({ t: s.t, snap: s.boards.find((x) => x.b === bn) ?? null }));
    const present = series.filter((p): p is PresentPt => p.snap !== null);
    if (present.length < 4) continue;

    const reasons: BoardReason[] = [];
    let high = false;
    let etaDays: number | undefined;

    const half = Math.floor(present.length / 2);
    const early = present.slice(0, half);
    const baseChips = median(early.map((p) => p.snap.chips));
    const baseGhs = median(early.map((p) => p.snap.ghs));

    // Board dropped out: present early, absent across the whole recent tail.
    const tail = Math.max(2, Math.floor(series.length / 4));
    const recentlyPresent = series.slice(-tail).some((p) => p.snap !== null);

    if (!recentlyPresent) {
      reasons.push({ code: "chipsLost", values: { b: bn, from: Math.round(baseChips), to: 0 } });
      high = true;
    } else {
      const cur = present[present.length - 1]!.snap;

      // Chips silently dying off.
      if (baseChips > 0 && cur.chips < baseChips) {
        const lostFrac = (baseChips - cur.chips) / baseChips;
        if (lostFrac >= 0.08) {
          reasons.push({ code: "chipsLost", values: { b: bn, from: Math.round(baseChips), to: cur.chips } });
          if (lostFrac >= 0.25) high = true;
        }
      }

      // This board's hashrate sliding vs its own baseline (+ ETA to half-dead).
      if (baseGhs > 0 && cur.ghs < baseGhs * 0.85) {
        reasons.push({ code: "boardRateDecline", values: { b: bn, from: Math.round(baseGhs), to: Math.round(cur.ghs) } });
        if (cur.ghs < baseGhs * 0.65) high = true;
        const slope = slopePerHour(present.map((p) => ({ t: p.t, y: p.snap.ghs })));
        if (slope < 0) {
          const dead = baseGhs * 0.5;
          etaDays = cur.ghs > dead ? Math.max(1, Math.round((cur.ghs - dead) / -slope / 24)) : 0;
        }
      }

      // HW-error rate accelerating (cumulative counter; ignore reboot resets).
      let accEarly = 0;
      let hrsEarly = 0;
      let accLate = 0;
      let hrsLate = 0;
      const mid = Math.floor(present.length / 2);
      for (let i = 1; i < present.length; i++) {
        const d = present[i]!.snap.hwErr - present[i - 1]!.snap.hwErr;
        const dh = (present[i]!.t - present[i - 1]!.t) / 3_600_000;
        if (d < 0 || dh <= 0) continue; // reboot reset or zero interval
        if (i <= mid) {
          accEarly += d;
          hrsEarly += dh;
        } else {
          accLate += d;
          hrsLate += dh;
        }
      }
      const rateEarly = hrsEarly > 0 ? accEarly / hrsEarly : 0;
      const rateLate = hrsLate > 0 ? accLate / hrsLate : 0;
      const perDayLate = rateLate * 24;
      if (perDayLate >= 500 && rateLate >= rateEarly * 2 && accLate >= 200) {
        reasons.push({ code: "hwErrorsClimbing", values: { b: bn, perDay: Math.round(perDayLate) } });
        if (perDayLate >= 5000) high = true;
      }
    }

    // Board that keeps appearing/disappearing (loose riser/PSU).
    let transitions = 0;
    for (let i = 1; i < series.length; i++) {
      if ((series[i - 1]!.snap !== null) !== (series[i]!.snap !== null)) transitions++;
    }
    if (recentlyPresent && transitions >= 4) {
      reasons.push({ code: "boardIntermittent", values: { b: bn, count: Math.ceil(transitions / 2) } });
    }

    if (reasons.length > 0) {
      out.push({ board: bn, severity: high ? "high" : "warn", reasons, ...(etaDays !== undefined ? { etaDays } : {}) });
    }
  }

  return out.sort(
    (a, b) => (a.severity === "high" ? 0 : 1) - (b.severity === "high" ? 0 : 1) || a.board - b.board,
  );
}
