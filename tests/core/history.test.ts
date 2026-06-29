import { describe, it, expect } from "vitest";
import { appendPoint, type HistoryPoint } from "../../src/renderer/state/history";

const pt = (t: number, ths = 100): HistoryPoint => ({ t, ths, temp: 65, online: 5, total: 5 });
const OPTS = { maxPoints: 3, minIntervalMs: 60000 };

describe("history.appendPoint", () => {
  it("adds the first point", () => {
    const h = appendPoint([], pt(1000), OPTS);
    expect(h).toHaveLength(1);
  });

  it("throttles points that arrive before minIntervalMs (same array ref)", () => {
    const h1 = appendPoint([], pt(1000), OPTS);
    const h2 = appendPoint(h1, pt(1000 + 30_000), OPTS); // 30s later -> dropped
    expect(h2).toBe(h1); // identical reference => no re-render
    const h3 = appendPoint(h1, pt(1000 + 60_000), OPTS); // 60s later -> kept
    expect(h3).toHaveLength(2);
  });

  it("caps to maxPoints, dropping the oldest", () => {
    let h: HistoryPoint[] = [];
    for (let i = 0; i < 5; i++) h = appendPoint(h, pt(i * 60_000, i), OPTS);
    expect(h).toHaveLength(3);
    expect(h.map((p) => p.ths)).toEqual([2, 3, 4]); // oldest (0,1) dropped
  });

  it("does not mutate the input array", () => {
    const h1 = appendPoint([], pt(0), OPTS);
    const copy = [...h1];
    appendPoint(h1, pt(60_000), OPTS);
    expect(h1).toEqual(copy);
  });
});
