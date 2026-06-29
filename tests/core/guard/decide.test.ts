import { describe, it, expect } from "vitest";
import { guardDecision, DEFAULT_GUARD } from "../../../src/core/guard/decide";

const on = { enabled: true, stopBelowMargin: 0 };

describe("guardDecision", () => {
  it("does nothing when disabled or data not ready", () => {
    expect(guardDecision(-50, true, DEFAULT_GUARD, false)).toBeNull();
    expect(guardDecision(-50, false, on, false)).toBeNull();
  });

  it("pauses when running and margin drops below threshold", () => {
    expect(guardDecision(-5, true, on, false)).toBe("stop");
    expect(guardDecision(2, true, on, false)).toBeNull(); // still profitable
  });

  it("resumes only after margin recovers past the hysteresis", () => {
    expect(guardDecision(1, true, on, true)).toBeNull(); // recovered but inside hysteresis (0..4)
    expect(guardDecision(5, true, on, true)).toBe("start"); // >= 0 + 4
  });

  it("respects a custom threshold", () => {
    const s = { enabled: true, stopBelowMargin: 10 };
    expect(guardDecision(8, true, s, false)).toBe("stop"); // below 10%
    expect(guardDecision(12, true, s, false)).toBeNull();
    expect(guardDecision(15, true, s, true)).toBe("start"); // >= 10 + 4
  });
});
