import { describe, it, expect } from "vitest";
import { parseChallenge, digestHeader } from "../../../src/main/transport/http";
import type { HttpRequest } from "../../../src/core/drivers/types";

describe("digest auth helpers", () => {
  it("parses a WWW-Authenticate digest challenge", () => {
    const c = parseChallenge(
      'Digest realm="antMiner Configuration", nonce="abc123", qop="auth", opaque="op"',
    );
    expect(c["realm"]).toBe("antMiner Configuration");
    expect(c["nonce"]).toBe("abc123");
    expect(c["qop"]).toBe("auth");
    expect(c["opaque"]).toBe("op");
  });

  it("builds a digest Authorization header (no-qop is deterministic)", () => {
    const req: HttpRequest = {
      host: "h",
      port: 80,
      method: "GET",
      path: "/cgi-bin/reboot.cgi",
      auth: { kind: "digest", user: "root", pass: "root" },
    };
    const header = digestHeader(req, { realm: "R", nonce: "N" });
    expect(header).toContain('username="root"');
    expect(header).toContain('realm="R"');
    expect(header).toContain('nonce="N"');
    expect(header).toContain('uri="/cgi-bin/reboot.cgi"');
    expect(/response="[a-f0-9]{32}"/.test(header)).toBe(true);
  });
});
