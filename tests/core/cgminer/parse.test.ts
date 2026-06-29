import { describe, it, expect } from "vitest";
import { parseResponse } from "../../../src/core/cgminer/parse";

const summaryRaw =
  '{"STATUS":[{"STATUS":"S"}],"SUMMARY":[{"GHS 5s":95200,"GHS av":94800,' +
  '"Device Hardware%":0.0021,"Elapsed":432000}],"id":1} ';

describe("parseResponse", () => {
  it("parses a SUMMARY section into an object", () => {
    const r = parseResponse(summaryRaw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.SUMMARY?.[0]?.["GHS 5s"]).toBe(95200);
      expect(r.value.SUMMARY?.[0]?.["Elapsed"]).toBe(432000);
    }
  });
  it("returns ok:false on garbage", () => {
    expect(parseResponse("not json").ok).toBe(false);
  });
});
