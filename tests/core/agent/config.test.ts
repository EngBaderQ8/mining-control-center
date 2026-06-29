import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync, existsSync } from "node:fs";
import { ConnectionConfig } from "../../../src/main/agent/config";

describe("ConnectionConfig", () => {
  it("generates a stable agentId and round-trips settings (in-memory)", () => {
    const c = new ConnectionConfig();
    const id1 = c.get().agentId;
    expect(id1).toMatch(/[0-9a-f-]{36}/);
    c.setServer("1.2.3.4:8443", "AB:CD");
    c.setToken("tok");
    expect(c.get()).toMatchObject({ serverAddr: "1.2.3.4:8443", fingerprint: "AB:CD", token: "tok", agentId: id1 });
    c.clearToken();
    expect(c.get().token).toBeUndefined();
  });

  it("persists to a file and keeps the same agentId across instances", () => {
    const path = join(tmpdir(), `mcc-conn-${process.pid}.json`);
    if (existsSync(path)) rmSync(path);
    try {
      const a = new ConnectionConfig(path);
      const id = a.get().agentId;
      a.setServer("5.6.7.8:8443", "FP");
      a.setToken("t1");
      const b = new ConnectionConfig(path);
      expect(b.get().agentId).toBe(id);
      expect(b.get().serverAddr).toBe("5.6.7.8:8443");
      expect(b.get().token).toBe("t1");
    } finally {
      if (existsSync(path)) rmSync(path);
    }
  });
});
