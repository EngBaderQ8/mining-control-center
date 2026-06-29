export interface GuardSettings {
  enabled: boolean;
  stopBelowMargin: number; // pause mining when the profit margin (%) drops below this
}

export const DEFAULT_GUARD: GuardSettings = { enabled: false, stopBelowMargin: 0 };

/** Hysteresis (percentage points) so the guard doesn't flap around the threshold. */
export const GUARD_HYSTERESIS = 4;

/**
 * Decide whether the profitability guard should pause or resume the fleet.
 * - pause ("stop") when running and the margin falls below the threshold,
 * - resume ("start") when paused and the margin recovers past threshold+hysteresis.
 * Returns null when no change is needed (or data isn't ready / guard disabled).
 */
export function guardDecision(
  marginPct: number,
  ready: boolean,
  settings: GuardSettings,
  paused: boolean,
): "stop" | "start" | null {
  if (!settings.enabled || !ready) return null;
  if (!paused && marginPct < settings.stopBelowMargin) return "stop";
  if (paused && marginPct >= settings.stopBelowMargin + GUARD_HYSTERESIS) return "start";
  return null;
}
