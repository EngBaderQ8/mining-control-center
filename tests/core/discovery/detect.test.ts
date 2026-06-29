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
});
