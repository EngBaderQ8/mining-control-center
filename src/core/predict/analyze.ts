export interface DeviceSample {
  t: number; // epoch ms
  temp: number; // °C
  ths: number; // TH/s
  online: boolean;
}

export type RiskLevel = "warn" | "high";
export type ReasonCode = "tempRising" | "hashDrop" | "flapping";
export interface PredReason {
  code: ReasonCode;
  values: Record<string, number>;
}

export interface Prediction {
  severity: RiskLevel;
  reasons: PredReason[];
}

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Least-squares slope of temperature vs time, returned in °C per hour. */
export function tempSlopePerHour(samples: DeviceSample[]): number {
  const pts = samples.filter((s) => s.online && s.temp > 0);
  const n = pts.length;
  if (n < 3) return 0;
  const t0 = pts[0]!.t;
  const xs = pts.map((p) => (p.t - t0) / 3_600_000); // hours
  const ys = pts.map((p) => p.temp);
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

/**
 * Predict trouble for a device from its recent samples: a rising temperature
 * trend nearing the overheat limit, a gradual hashrate decline, or repeated
 * disconnects. Returns null when the device looks healthy.
 */
export function analyzeTrend(samples: DeviceSample[], opts: { overheatC: number }): Prediction | null {
  if (samples.length < 5) return null;
  const latest = samples[samples.length - 1]!;
  const online = samples.filter((s) => s.online && s.temp > 0);
  const reasons: PredReason[] = [];
  let high = false;

  // Rising temperature heading toward the overheat threshold.
  if (online.length >= 5 && latest.online) {
    const slope = tempSlopePerHour(samples);
    if (slope >= 3 && latest.temp >= opts.overheatC - 12) {
      reasons.push({ code: "tempRising", values: { slope: Math.round(slope * 10) / 10, temp: latest.temp } });
      if (latest.temp >= opts.overheatC - 5) high = true;
    }
  }

  // Gradual hashrate decline vs the device's own earlier baseline.
  if (latest.online && online.length >= 6) {
    const half = Math.floor(online.length / 2);
    const baseline = median(online.slice(0, half).map((s) => s.ths));
    if (baseline > 0 && latest.ths < baseline * 0.8) {
      reasons.push({ code: "hashDrop", values: { from: Math.round(baseline), to: Math.round(latest.ths) } });
      if (latest.ths < baseline * 0.6) high = true;
    }
  }

  // Repeated brief disconnects (instability).
  let flaps = 0;
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1]!.online && !samples[i]!.online) flaps++;
  }
  if (flaps >= 3) reasons.push({ code: "flapping", values: { count: flaps } });

  if (reasons.length === 0) return null;
  return { severity: high ? "high" : "warn", reasons };
}
