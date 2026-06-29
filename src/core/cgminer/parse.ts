import { cleanRawResponse } from "./protocol";
import type { Result } from "../model/result";

/** A single section row from a cgminer/bmminer API response. Real firmware mixes
 *  numbers, strings, and booleans (e.g. POOLS."Stratum Active"). */
export type CgminerSection = Record<string, number | string | boolean>;

export interface CgminerResponse {
  STATUS?: Array<Record<string, unknown>>;
  SUMMARY?: CgminerSection[];
  STATS?: CgminerSection[];
  POOLS?: CgminerSection[];
  DEVS?: CgminerSection[];
  VERSION?: CgminerSection[];
  id?: number;
}

export function parseResponse(raw: string): Result<CgminerResponse> {
  try {
    return { ok: true, value: JSON.parse(cleanRawResponse(raw)) as CgminerResponse };
  } catch (e) {
    return { ok: false, error: `parse failed: ${(e as Error).message}` };
  }
}
