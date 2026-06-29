import { describe, it, expect } from "vitest";
import { firmwareDefaultSecret, resolveSecret } from "../../../src/core/drivers/defaults";

describe("firmware default credentials", () => {
  it("maps each firmware to its built-in default", () => {
    expect(firmwareDefaultSecret("stock")).toBe("root:root");
    expect(firmwareDefaultSecret("vnish")).toBe("admin");
    expect(firmwareDefaultSecret("braiins")).toBe(""); // open LAN API
    expect(firmwareDefaultSecret("luxos")).toBe(""); // session via logon
  });

  it("uses the user secret when set, else the firmware default", () => {
    expect(resolveSecret("stock", "root:MyPass")).toBe("root:MyPass");
    expect(resolveSecret("stock", "")).toBe("root:root");
    expect(resolveSecret("stock", undefined)).toBe("root:root");
    expect(resolveSecret("vnish", undefined)).toBe("admin");
  });
});
