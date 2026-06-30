import { describe, it, expect } from "vitest";
import { parsePools, lastOctet } from "../../../src/core/drivers/pools";

describe("parsePools", () => {
  it("parses up to 3 pools from poolsJson, dropping incomplete ones", () => {
    const poolsJson = JSON.stringify([
      { url: "stratum+tcp://a:3333", user: "acc.1", pass: "x" },
      { url: "stratum+tcp://b:3333", user: "acc.2", pass: "y" },
      { url: "", user: "nope", pass: "x" }, // dropped (no url)
    ]);
    const r = parsePools({ poolsJson });
    expect(r).toHaveLength(2);
    expect(r[0]).toEqual({ url: "stratum+tcp://a:3333", user: "acc.1", pass: "x" });
  });

  it("caps at 3 pools", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      url: `stratum+tcp://u${i}:3333`,
      user: `w${i}`,
      pass: "x",
    }));
    expect(parsePools({ poolsJson: JSON.stringify(many) })).toHaveLength(3);
  });

  it("rejects fields that could inject extra cgminer addpool args, or a non-stratum url", () => {
    const bad = JSON.stringify([
      { url: "stratum+tcp://evil:3333,attacker,x", user: "w", pass: "x" }, // comma in url
      { url: "http://nope:3333", user: "w", pass: "x" }, // not stratum
      { url: "stratum+tcp://ok:3333", user: "good,inject", pass: "x" }, // comma in user
      { url: "stratum+tcp://ok:3333", user: "fine", pass: "p\nx" }, // newline in pass
    ]);
    expect(parsePools({ poolsJson: bad })).toEqual([]);
    // a clean stratum pool still passes
    expect(
      parsePools({ poolsJson: JSON.stringify([{ url: "stratum+ssl://btc.pool.com:443", user: "acc.w", pass: "x" }]) }),
    ).toEqual([{ url: "stratum+ssl://btc.pool.com:443", user: "acc.w", pass: "x" }]);
  });

  it("falls back to the legacy single url/user/pass", () => {
    const r = parsePools({ url: "stratum+tcp://a:3333", user: "acc", pass: "p" });
    expect(r).toEqual([{ url: "stratum+tcp://a:3333", user: "acc", pass: "p" }]);
  });

  it("returns empty for nothing usable", () => {
    expect(parsePools({})).toEqual([]);
    expect(parsePools({ poolsJson: "not json" })).toEqual([]);
  });
});

describe("lastOctet", () => {
  it("returns the trailing number of an IPv4 host", () => {
    expect(lastOctet("192.168.0.101")).toBe("101");
    expect(lastOctet("10.0.0.1")).toBe("1");
  });
  it("returns null for non-numeric/DDNS hosts", () => {
    expect(lastOctet("site.ddns.net")).toBeNull();
    expect(lastOctet("miner-host")).toBeNull();
  });
});
