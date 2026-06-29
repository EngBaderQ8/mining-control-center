import { describe, it, expect } from "vitest";
import { probeHost, scanHosts, subnetHosts } from "../../../src/core/discovery/scan";
import type { Transport } from "../../../src/core/drivers/types";

// Fake transport: .50 and .51 are miners; everything else refuses.
function fakeNet(): Transport {
  return {
    async tcp4028(host) {
      if (host.endsWith(".50")) return '{"VERSION":[{"Type":"Antminer S19","BMMiner":"2.0"}]}';
      if (host.endsWith(".51")) return '{"VERSION":[{"Type":"S19j","LUXminer":"2024"}]}';
      throw new Error("ECONNREFUSED");
    },
    async http() {
      throw new Error("n/a");
    },
  };
}

describe("scan", () => {
  it("probeHost returns a discovered device for a miner, null otherwise", async () => {
    const t = fakeNet();
    expect(await probeHost("192.168.1.50", 4028, t)).toMatchObject({ firmware: "stock" });
    expect(await probeHost("192.168.1.99", 4028, t)).toBeNull();
  });

  it("scanHosts finds only the miners, respecting concurrency", async () => {
    const t = fakeNet();
    const hosts = Array.from({ length: 20 }, (_, i) => `192.168.1.${i + 40}`);
    const found = await scanHosts(hosts, 4028, t, 8);
    expect(found).toHaveLength(2);
    expect(found.map((d) => d.host).sort()).toEqual(["192.168.1.50", "192.168.1.51"]);
    expect(found.find((d) => d.host.endsWith(".51"))?.firmware).toBe("luxos");
  });

  it("subnetHosts builds .1–.254 from a base or full IP", () => {
    for (const input of ["192.168.1.77", "192.168.1"]) {
      const hosts = subnetHosts(input);
      expect(hosts).toHaveLength(254);
      expect(hosts[0]).toBe("192.168.1.1");
      expect(hosts[253]).toBe("192.168.1.254");
    }
    expect(subnetHosts("bad")).toEqual([]);
    expect(subnetHosts("192.168")).toEqual([]);
  });

  it("rejects out-of-range / malformed octets", () => {
    expect(subnetHosts("300.1.1")).toEqual([]); // 300 > 255
    expect(subnetHosts("192..1")).toEqual([]); // empty middle octet
    expect(subnetHosts("1e2.1.1")).toEqual([]); // exponent form
    expect(subnetHosts("192.168.1.2.3")).toEqual([]); // too many octets
    expect(subnetHosts("255.255.255")).toHaveLength(254); // boundary OK
  });
});
