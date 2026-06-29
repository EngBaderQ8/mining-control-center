import { cleanRawResponse } from "./protocol";
import type { Result } from "../model/result";

export interface CgminerResponse {
  STATUS?: Array<Record<string, unknown>>;
  SUMMARY?: Array<Record<string, number | string>>;
  STATS?: Array<Record<string, number | string>>;
  POOLS?: Array<Record<string, number | string>>;
  DEVS?: Array<Record<string, number | string>>;
  id?: number;
}

export function parseResponse(raw: string): Result<CgminerResponse> {
  try {
    return { ok: true, value: JSON.parse(cleanRawResponse(raw)) as CgminerResponse };
  } catch (e) {
    return { ok: false, error: `parse failed: ${(e as Error).message}` };
  }
}
