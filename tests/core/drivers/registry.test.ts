import { describe, it, expect } from "vitest";
import { getDriver } from "../../../src/core/drivers/registry";
import type { Firmware } from "../../../src/core/model/device";

describe("driver registry", () => {
  it("resolves every firmware", () => {
    for (const f of ["stock", "braiins", "vnish", "luxos"] as Firmware[]) {
      expect(getDriver(f).firmware).toBe(f);
    }
  });
});
