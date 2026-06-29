export interface HistoryPoint {
  t: number; // epoch ms
  ths: number; // total fleet hashrate (TH/s)
  temp: number; // average device temperature (°C)
  online: number; // online device count
  total: number; // total device count
}

export interface AppendOpts {
  maxPoints: number;
  minIntervalMs: number;
}

/**
 * Append a fleet snapshot to the history, throttled (drop points that arrive
 * sooner than minIntervalMs after the last) and capped to maxPoints (oldest
 * dropped). Pure: returns the SAME array reference when nothing changes, so a
 * React setState skips a re-render.
 */
export function appendPoint(history: HistoryPoint[], p: HistoryPoint, opts: AppendOpts): HistoryPoint[] {
  const last = history[history.length - 1];
  if (last && p.t - last.t < opts.minIntervalMs) return history;
  const next = history.concat(p);
  return next.length > opts.maxPoints ? next.slice(next.length - opts.maxPoints) : next;
}

const KEY = "mcc.history";

export function loadHistory(): HistoryPoint[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as HistoryPoint[];
  } catch {
    /* ignore */
  }
  return [];
}

export function saveHistory(h: HistoryPoint[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    /* ignore quota/availability */
  }
}
