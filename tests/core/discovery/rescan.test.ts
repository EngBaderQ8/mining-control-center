import { describe, it, expect } from "vitest";
import { siteSubnetBases, hostsToRescan } from "../../../src/core/discovery/rescan";
import type { Device } from "../../../src/core/model/device";

const dev = (id: string, siteId: string, host: string): Device => ({
  id,
  siteId,
  name: id,
  model: "M",
  firmware: "stock",
  host,
  apiPort: 4028,
  controlPort: 80,
});

describe("rescan helpers", () => {
  it("derives unique /24 bases from a site's IPv4 devices, ignoring non-IPv4 hosts", () => {
    const devices = [
      dev("a", "s1", "192.168.0.10"),
      dev("b", "s1", "192.168.0.20"),
      dev("c", "s1", "10.0.5.3"),
      dev("d", "s1", "miner.local"), // not IPv4 — ignored
      dev("e", "s2", "172.16.1.4"), // other site — ignored
    ];
    expect(siteSubnetBases("s1", devices).sort()).toEqual(["10.0.5", "192.168.0"]);
  });

  it("returns only UNREGISTERED IPs to probe (never re-scans a working miner)", () => {
    const devices = [dev("a", "s1", "192.168.0.10"), dev("b", "s1", "192.168.0.20")];
    const fakeSubnet = (base: string) => [`${base}.10`, `${base}.11`, `${base}.20`, `${base}.21`];
    expect(hostsToRescan("s1", devices, fakeSubnet)).toEqual(["192.168.0.11", "192.168.0.21"]);
  });

  it("returns nothing when the site has no IPv4 devices", () => {
    const devices = [dev("d", "s1", "miner.local")];
    expect(hostsToRescan("s1", devices, () => ["x"])).toEqual([]);
  });
});
