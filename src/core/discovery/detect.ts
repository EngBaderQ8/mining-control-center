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
    // Accept ONLY a real model marker — NEVER a firmware-version field. Whatsminer's model
    // lives in "minertype"/"model" (e.g. "M50S+V50"); "platform" (H6OS) is the OS and
    // "fw_ver" is the firmware VERSION. Using fw_ver as the model made the version string
    // show up as the device name (e.g. "20250915.16-16").
    const m =
      /"Type"\s*:\s*"([^"]+)"/i.exec(text) ??
      /"(?:minertype|miner_type|model)"\s*:\s*"([^"]+)"/i.exec(text);
    if (m && m[1]) model = m[1];
  }
  // A bare cgminer `version` on Whatsminer may not carry "Type" — make the label
  // explicit so the UI + catalog identify it as a Whatsminer.
  if (firmware === "whatsminer" && model === "ASIC") model = "Whatsminer";

  return { firmware, model };
}

/**
 * Pull a real Whatsminer MODEL (e.g. "M30S+", "M50S", "M60S") from ANY btminer reply —
 * the newer get.device.info (minertype), or legacy devdetails/stats/get_miner_info
 * (Model / Type). Returns a clean model, or null when the reply carries only a firmware
 * version (so we never re-introduce the version-as-name bug). Field-name-agnostic by regex
 * so it works regardless of which command/firmware answered.
 */
export function extractWhatsminerModel(raw: string): string | null {
  const text = raw.replace(/\0/g, "");
  const m =
    /"minertype"\s*:\s*"([^"]+)"/i.exec(text) ??
    /"miner_type"\s*:\s*"([^"]+)"/i.exec(text) ??
    /"Model"\s*:\s*"([^"]+)"/i.exec(text) ??
    /"Type"\s*:\s*"(WhatsMiner[^"]*|M\d[^"]*)"/i.exec(text);
  let model = m?.[1]?.trim().replace(/^whatsminer\s+/i, "");
  if (!model) return null;
  // Guard: some firmwares put a version string in these fields — never accept that.
  if (/^\d{6,}|^rel\d|\d{8}/i.test(model)) return null;
  return model;
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
