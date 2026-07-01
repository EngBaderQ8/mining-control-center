import { describe, it, expect } from "vitest";
import { detectFromVersion, extractWhatsminerModel } from "../../../src/core/discovery/detect";

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

  it("detects the real S19 XP+ Hyd version response (spaces after colons)", () => {
    const real =
      '{"STATUS": [{"STATUS": "S", "When": 1782750427, "Code": 22, "Msg": "CGMiner versions", "Description": "bmminer 1.0.0"}], "VERSION": [{"BMMiner": "1.0.0", "API": "3.1", "Miner": "uart", "CompileTime": "x", "Type": "Antminer S19 XP+ Hyd"}], "id": 1}';
    const d = detectFromVersion(real);
    expect(d).not.toBeNull();
    expect(d?.firmware).toBe("stock");
    expect(d?.model).toBe("Antminer S19 XP+ Hyd");
  });

  it("does NOT use fw_ver as the Whatsminer model — falls back to a clean 'Whatsminer'", () => {
    const wm = '{"STATUS":[{"STATUS":"S"}],"Msg":{"api_ver":"2.0.7","fw_ver":"20250915.16"}}';
    const d = detectFromVersion(wm);
    expect(d?.firmware).toBe("whatsminer");
    expect(d?.model).toBe("Whatsminer"); // never the firmware-version string
  });

  it("reads the real Whatsminer model from minertype when present", () => {
    const wm = '{"STATUS":[{"STATUS":"S"}],"Msg":{"minertype":"M50S+V50","fw_ver":"20250915.16"}}';
    const d = detectFromVersion(wm);
    expect(d?.firmware).toBe("whatsminer");
    expect(d?.model).toBe("M50S+V50");
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

describe("extractWhatsminerModel", () => {
  it("reads minertype (newer get.device.info)", () => {
    expect(extractWhatsminerModel('{"Msg":{"minertype":"M30S+V50","fw_ver":"20250915.16"}}')).toBe("M30S+V50");
  });
  it("reads Model (legacy devdetails)", () => {
    expect(extractWhatsminerModel('{"DEVDETAILS":[{"Model":"M50S"}]}')).toBe("M50S");
  });
  it("reads a Whatsminer Type and strips the vendor prefix", () => {
    expect(extractWhatsminerModel('{"STATS":[{"Type":"WhatsMiner M60S"}]}')).toBe("M60S");
  });
  it("returns null when only a firmware version is present", () => {
    expect(extractWhatsminerModel('{"Msg":{"fw_ver":"20250915.16","api_ver":"2.0"}}')).toBeNull();
    expect(extractWhatsminerModel('{"minertype":"20250915.16"}')).toBeNull(); // version, not a model
  });
});
