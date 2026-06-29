import type { Firmware } from "../model/device";
import { parseResponse } from "../cgminer/parse";

export interface Detected {
  firmware: Firmware;
  model: string;
}

/**
 * Identify an ASIC and its firmware from a cgminer `version` response. Firmware
 * is inferred from firmware-specific fields in the VERSION section; defaults to
 * "stock" for a Bitmain-style miner. Returns null if it isn't a miner at all.
 */
export function detectFromVersion(raw: string): Detected | null {
  const parsed = parseResponse(raw);
  if (!parsed.ok) return null;
  const version = parsed.value.VERSION;
  if (!Array.isArray(version) || !version[0]) return null;
  const v = version[0];
  const keys = Object.keys(v).map((k) => k.toLowerCase());
  const has = (needle: string): boolean => keys.some((k) => k.includes(needle));

  // Anything that answers the 4028 `version` command with a VERSION entry is a
  // miner. Prefer a "Type" but accept any non-empty version row.
  if (Object.keys(v).length === 0) return null;

  let firmware: Firmware = "stock";
  if (has("luxminer") || has("luxos")) firmware = "luxos";
  else if (has("bos") || has("braiins")) firmware = "braiins";
  else if (has("vnish")) firmware = "vnish";

  return { firmware, model: String(v["Type"] ?? "ASIC") };
}
