import { describe, it, expect } from "vitest";
import { buildRequest, cleanRawResponse } from "../../../src/core/cgminer/protocol";

describe("cgminer protocol", () => {
  it("builds a JSON command request", () => {
    expect(buildRequest("summary")).toBe('{"command":"summary"}');
    expect(buildRequest("stats", "0")).toBe('{"command":"stats","parameter":"0"}');
  });
  it("strips trailing NUL and whitespace before parsing", () => {
    expect(cleanRawResponse('{"a":1} ')).toBe('{"a":1}');
    expect(cleanRawResponse('{"a":1}\n')).toBe('{"a":1}');
  });
  it("strips actual NUL terminators/padding so JSON.parse succeeds", () => {
    const nul = String.fromCharCode(0);
    expect(cleanRawResponse('{"a":1}' + nul)).toBe('{"a":1}');
    expect(cleanRawResponse('{"a":1}' + nul.repeat(8))).toBe('{"a":1}');
    expect(cleanRawResponse('{"a":1}  ' + nul)).toBe('{"a":1}');
    expect(() => JSON.parse(cleanRawResponse('{"a":1}' + nul))).not.toThrow();
  });
  it("repairs the known invalid-JSON quirk (comma before })", () => {
    expect(cleanRawResponse('{"a":1,} ')).toBe('{"a":1}');
  });
});
