import { describe, it, expect } from "vitest";
import { detectIncidents } from "../../../server/src/monitor/ownerAlerts";

const NOW = 100_000_000; // well past the 30-min cooldown from lastAlertAt:0
const acct = (id: string, online: number, hashrate: number, devices = 10) => ({
  id,
  email: `${id}@x.com`,
  devices,
  online,
  hashrate,
});
const prevOf = (online: number, hashrate: number, lastAlertAt = 0) => ({
  a: { online, hashrate, baselineHashrate: hashrate, lastAlertAt },
});

describe("detectIncidents", () => {
  it("fires a mass-offline incident when ≥3 AND ≥20% of a fleet drops", () => {
    const { incidents } = detectIncidents([acct("a", 5, 500)], prevOf(10, 1000), NOW);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.message).toContain("هبط");
  });

  it("fires a hashrate-crash incident on ≥25% drop (no mass offline)", () => {
    const { incidents } = detectIncidents([acct("a", 10, 700)], prevOf(10, 1000), NOW);
    expect(incidents).toHaveLength(1);
    expect(incidents[0]!.message).toContain("الهاش");
  });

  it("does NOT fire for small drops", () => {
    const { incidents } = detectIncidents([acct("a", 9, 950)], prevOf(10, 1000), NOW);
    expect(incidents).toHaveLength(0);
  });

  it("respects the per-account cooldown (no repeat within 30 min)", () => {
    const { incidents } = detectIncidents([acct("a", 2, 200)], prevOf(10, 1000, NOW - 60_000), NOW);
    expect(incidents).toHaveLength(0);
  });

  it("no incident on first sight (no previous state), but records state", () => {
    const { incidents, state } = detectIncidents([acct("a", 5, 500)], {}, NOW);
    expect(incidents).toHaveLength(0);
    expect(state["a"]!.online).toBe(5);
  });

  it("catches a GRADUAL hashrate decline via the decaying baseline (no single step ≥25%)", () => {
    // 1000 → 760 → 578 (~24%/run): no single 2-min step trips 25%, but the
    // high-water baseline accumulates the bleed and fires by the 3rd run.
    let st = detectIncidents([acct("a", 10, 1000)], {}, NOW).state; // baseline 1000
    st = detectIncidents([acct("a", 10, 760)], st, NOW).state; // 24% vs prev → not yet
    const r3 = detectIncidents([acct("a", 10, 578)], st, NOW);
    expect(r3.incidents).toHaveLength(1);
    expect(r3.incidents[0]!.message).toContain("الهاش");
  });

  it("does not divide-by-zero or false-fire on a 0→0 fleet", () => {
    const { incidents } = detectIncidents([acct("a", 0, 0, 0)], prevOf(0, 0), NOW);
    expect(incidents).toHaveLength(0);
  });

  it("stamps lastAlertAt only when it fired (so the cooldown starts)", () => {
    const fired = detectIncidents([acct("a", 2, 200)], prevOf(10, 1000), NOW);
    expect(fired.state["a"]!.lastAlertAt).toBe(NOW);
    const quiet = detectIncidents([acct("a", 10, 1000)], prevOf(10, 1000), NOW);
    expect(quiet.state["a"]!.lastAlertAt).toBe(0);
  });
});
