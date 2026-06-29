import { describe, it, expect } from "vitest";
import { detectFromVersion } from "../../../src/core/discovery/detect";

describe("detectFromVersion", () => {
  it("detects LuxOS, Braiins, Vnish, and falls back to stock", () => {
    expect(
      detectFromVersion('{"VERSION":[{"Type":"Antminer S19","LUXminer":"2024.1.1"}]}'),
    ).toMatchObject({ firmware: "luxos", model: "Antminer S19" });
    expect(detectFromVersion('{"VERSION":[{"Type":"S19j Pro","BOSminer+":"1.0"}]}')).toMatchObject({
      firmware: "braiins",
    });
    expect(detectFromVersion('{"VERSION":[{"Type":"Antminer S19","VNish":"1.2.3"}]}')).toMatchObject(
      { firmware: "vnish" },
    );
    expect(
      detectFromVersion('{"VERSION":[{"Type":"Antminer S19 Pro","BMMiner":"2.0","API":"3.1"}]}'),
    ).toMatchObject({ firmware: "stock", model: "Antminer S19 Pro" });
  });

  it("returns null when the response is not a miner", () => {
    expect(detectFromVersion("not json")).toBeNull();
    expect(detectFromVersion('{"foo":1}')).toBeNull();
  });

  it("still detects a miner from MALFORMED JSON (bmminer quirk)", () => {
    // Missing closing brace / trailing junk but clear miner markers.
    const malformed =
      '{"STATUS":[{"STATUS":"S"}],"VERSION":[{"Type":"Antminer S19 XP+ Hyd","BMMiner":"2.0",}],';
    const d = detectFromVersion(malformed);
    expect(d).not.toBeNull();
    expect(d?.firmware).toBe("stock");
    expect(d?.model).toContain("S19 XP+ Hyd");
  });
});
