import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "../../../server/src/auth/jwt";

describe("jwt", () => {
  it("round-trips a userId and rejects tampered tokens", () => {
    const t = signToken("user-1", "secret");
    expect(verifyToken(t, "secret")).toBe("user-1");
    expect(verifyToken(t + "x", "secret")).toBeNull();
    expect(verifyToken(t, "other-secret")).toBeNull();
  });
});
