import { describe, it, expect } from "vitest";
import { lookupSpec, deviceJPerTh } from "../../../src/core/devices/catalog";

describe("lookupSpec", () => {
  it("identifies an S19 XP+ Hyd as a water-cooled Bitmain miner", () => {
    const s = lookupSpec("Antminer S19 XP+ Hyd.-101");
    expect(s?.vendor).toBe("Bitmain");
    expect(s?.cooling).toBe("hydro");
    expect(s?.model).toMatch(/S19 XP Hyd/);
  });

  it("matches the most specific model first (XP Hyd, not plain S19)", () => {
    expect(lookupSpec("S19")?.cooling).toBe("air");
    expect(lookupSpec("S19 XP Hyd")?.cooling).toBe("hydro");
  });

  it("identifies a Whatsminer as MicroBT", () => {
    expect(lookupSpec("Whatsminer M50S")?.vendor).toBe("MicroBT");
  });

  it("infers cooling from the name for an unknown model", () => {
    const s = lookupSpec("SomeNew Hydro 9000");
    expect(s?.cooling).toBe("hydro");
  });

  it("returns null for empty input", () => {
    expect(lookupSpec("")).toBeNull();
    expect(lookupSpec(undefined)).toBeNull();
  });

  it("gives each model its own rated efficiency (for accurate mixed-site power)", () => {
    expect(lookupSpec("Antminer S19 XP Hyd")?.jPerTh).toBe(20.8);
    expect(lookupSpec("Antminer S21 XP Hyd")?.jPerTh).toBe(12);
    expect(lookupSpec("Whatsminer M60S")?.jPerTh).toBe(18.5);
  });

  it("deviceJPerTh uses the model's efficiency, else the provided fallback", () => {
    expect(deviceJPerTh("Antminer S21 XP Hyd", 99)).toBe(12); // known → model's value
    expect(deviceJPerTh("Antminer S19 XP Hyd", 99)).toBe(20.8);
    expect(deviceJPerTh("TotallyUnknown 5000", 25)).toBe(25); // unknown → fallback
    expect(deviceJPerTh("", 25)).toBe(25);
  });
});
