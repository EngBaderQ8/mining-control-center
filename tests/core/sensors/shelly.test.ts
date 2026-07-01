import { describe, it, expect } from "vitest";
import { parseShelly, evalEnv } from "../../../src/core/sensors/shelly";

describe("parseShelly", () => {
  it("reads a Gen1 H&T native probe (tmp/hum/bat)", () => {
    const r = parseShelly({ tmp: { tC: 34.2, is_valid: true }, hum: { value: 55 }, bat: { value: 72 } });
    expect(r).toEqual({ tempC: 34.2, humidity: 55, battery: 72 });
  });

  it("reads a Gen2/Gen3 RPC status (temperature:0 / humidity:0)", () => {
    const r = parseShelly({ "temperature:0": { id: 0, tC: 41.5, tF: 106.7 }, "humidity:0": { id: 0, rh: 30 } });
    expect(r?.tempC).toBe(41.5);
    expect(r?.humidity).toBe(30);
  });

  it("reads a Gen1 external probe (ext_temperature/ext_humidity)", () => {
    const r = parseShelly({ ext_temperature: { "0": { tC: 28 } }, ext_humidity: { "0": { hum: 60 } } });
    expect(r).toEqual({ tempC: 28, humidity: 60 });
  });

  it("returns null when no climate data is present", () => {
    expect(parseShelly({ relays: [{ ison: true }] })).toBeNull();
    expect(parseShelly("nope")).toBeNull();
    expect(parseShelly(null)).toBeNull();
  });
});

describe("evalEnv", () => {
  it("flags a hot room high at/above the limit, warn just below", () => {
    expect(evalEnv({ tempC: 46 }, { maxTempC: 45 })).toEqual([{ code: "roomHot", severity: "high", value: 46, limit: 45 }]);
    expect(evalEnv({ tempC: 42 }, { maxTempC: 45 })[0]).toMatchObject({ code: "roomHot", severity: "warn" });
    expect(evalEnv({ tempC: 30 }, { maxTempC: 45 })).toEqual([]);
  });

  it("flags high humidity and low battery", () => {
    expect(evalEnv({ humidity: 85 }, { maxHumidity: 80 })[0]).toMatchObject({ code: "roomHumid", severity: "high" });
    expect(evalEnv({ tempC: 30, battery: 10 }, { maxTempC: 45 })).toContainEqual({
      code: "sensorLowBattery",
      severity: "warn",
      value: 10,
      limit: 15,
    });
  });

  it("ignores thresholds left at 0/undefined", () => {
    expect(evalEnv({ tempC: 99, humidity: 99 }, {})).toEqual([]);
    expect(evalEnv({ tempC: 99 }, { maxTempC: 0 })).toEqual([]);
  });
});
