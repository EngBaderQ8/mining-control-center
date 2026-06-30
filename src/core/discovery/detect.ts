import type { Firmware } from "../model/device";
import { parseResponse } from "../cgminer/parse";

export interface Detected {
  firmware: Firmware;
  model: string;
}

/**
 * Identify an ASIC from a cgminer/bmminer `version` response. Lenient on purpose:
 * bmminer sometimes returns slightly malformed JSON, so we try strict JSON first
 * and fall back to string/regex markers — anything that clearly came from a miner
 * counts. Firmware is best-effort; defaults to "stock".
 */
export function detectFromVersion(raw: string): Detected | null {
  const text = raw.replace(/\0/g, "").trim();
  if (!text) return null;

  // Strict JSON path (typical, well-formed response).
  let versionRow: Record<string, unknown> | null = null;
  const parsed = parseResponse(text);
  if (parsed.ok && Array.isArray(parsed.value.VERSION) && parsed.value.VERSION[0]) {
    versionRow = parsed.value.VERSION[0] as Record<string, unknown>;
  }

  // A miner if we got a VERSION row, or the raw text carries a known miner marker.
  // Whatsminer markers added: it answers cgminer `version` (Type "WhatsMiner …")
  // or new-style `get_version` (platform H6OS/M6OS, api_ver/fw_ver), and reports
  // hashrate in MHS (never GHS) — none of the Antminer markers apply.
  const isWhatsminer = /whatsminer|microbt|btminer|"api_ver"|"fw_ver"|H6OS|M6OS/i.test(text);
  const isMiner =
    versionRow !== null ||
    isWhatsminer ||
    /BMMiner|CGMiner|BOSminer|LUXminer|VNish|Antminer|"VERSION"|"STATUS"|GHS|MHS/i.test(text);
  if (!isMiner) return null;

  let firmware: Firmware = "stock";
  if (isWhatsminer) firmware = "whatsminer";
  else if (/lux(miner|os)/i.test(text)) firmware = "luxos";
  else if (/bos(miner)?|braiins/i.test(text)) firmware = "braiins";
  else if (/vnish/i.test(text)) firmware = "vnish";

  let model = "ASIC";
  if (versionRow && typeof versionRow["Type"] === "string") model = String(versionRow["Type"]);
  else {
    const m =
      /"Type"\s*:\s*"([^"]+)"/i.exec(text) ?? /"(?:platform|fw_ver)"\s*:\s*"([^"]+)"/i.exec(text);
    if (m && m[1]) model = m[1];
  }
  // A bare cgminer `version` on Whatsminer may not carry "Type" — make the label
  // explicit so the UI + catalog identify it as a Whatsminer.
  if (firmware === "whatsminer" && model === "ASIC") model = "Whatsminer";

  return { firmware, model };
}

/**
 * Extract a stable hardware identity (MAC address) from any raw miner reply. Done by
 * REGEX over the whole text — not a fixed field name — so it works regardless of which
 * command/firmware exposed it (Whatsminer get_miner_info, an Antminer field, etc.).
 * Returns a normalised lowercase colon MAC, or null. Ignores the all-zero/broadcast
 * placeholders so we never treat "no MAC" as a real identity.
 */
export function extractMac(raw: string): string | null {
  const m = /(?:[0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}/.exec(raw.replace(/\0/g, ""));
  if (!m) return null;
  const mac = m[0].replace(/-/g, ":").toLowerCase();
  if (mac === "00:00:00:00:00:00" || mac === "ff:ff:ff:ff:ff:ff") return null;
  return mac;
}
