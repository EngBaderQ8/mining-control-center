/**
 * Read a Shelly temperature/humidity sensor over its LOCAL HTTP API — no cloud,
 * no account. The site agent polls the sensor's LAN IP the same way it polls a
 * miner, so room climate rides the existing agent→server→viewer path.
 *
 * Handles the three shapes a Shelly can answer with:
 *  - Gen1  GET /status          → { tmp:{tC}, hum:{value}, bat:{value} }
 *  - Gen1 w/ external probe      → { ext_temperature:{"0":{tC}}, ext_humidity:{"0":{hum}} }
 *  - Gen2/Gen3 GET /rpc/Shelly.GetStatus → { "temperature:0":{tC}, "humidity:0":{rh} }
 */

export interface EnvReading {
  tempC?: number; // °C
  humidity?: number; // %RH
  battery?: number; // % (battery sensors only)
}

export interface EnvThresholds {
  maxTempC?: number; // room is too hot at/above this (°C)
  maxHumidity?: number; // room is too humid at/above this (%RH)
}

export type EnvIssueCode = "roomHot" | "roomHumid" | "sensorLowBattery";
export interface EnvIssue {
  code: EnvIssueCode;
  severity: "warn" | "high";
  value: number;
  limit: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Extract °C/%RH/battery from any supported Shelly status JSON. Returns null if none found. */
export function parseShelly(json: unknown): EnvReading | null {
  if (!isObj(json)) return null;
  const out: EnvReading = {};

  // Gen1 native probe: tmp.tC / tmp.value, hum.value, bat.value
  if (isObj(json.tmp)) out.tempC = num(json.tmp.tC) ?? num(json.tmp.value);
  if (isObj(json.hum)) out.humidity = num(json.hum.value) ?? num(json.hum.rh);
  if (isObj(json.bat)) out.battery = num(json.bat.value);

  // Gen1 external probe: ext_temperature["0"].tC, ext_humidity["0"].hum
  if (out.tempC === undefined && isObj(json.ext_temperature)) {
    const first = Object.values(json.ext_temperature).find(isObj);
    if (first) out.tempC = num(first.tC) ?? num(first.value);
  }
  if (out.humidity === undefined && isObj(json.ext_humidity)) {
    const first = Object.values(json.ext_humidity).find(isObj);
    if (first) out.humidity = num(first.hum) ?? num(first.value);
  }

  // Gen2/Gen3 RPC: "temperature:N".tC, "humidity:N".rh
  if (out.tempC === undefined) {
    for (const [k, v] of Object.entries(json)) {
      if (k.startsWith("temperature:") && isObj(v)) {
        const t = num(v.tC);
        if (t !== undefined) {
          out.tempC = t;
          break;
        }
      }
    }
  }
  if (out.humidity === undefined) {
    for (const [k, v] of Object.entries(json)) {
      if (k.startsWith("humidity:") && isObj(v)) {
        const h = num(v.rh);
        if (h !== undefined) {
          out.humidity = h;
          break;
        }
      }
    }
  }

  if (out.tempC === undefined && out.humidity === undefined) return null;
  return out;
}

/** Flag a room that is too hot / too humid, or a sensor running low on battery. */
export function evalEnv(r: EnvReading, th: EnvThresholds): EnvIssue[] {
  const issues: EnvIssue[] = [];
  if (r.tempC !== undefined && th.maxTempC !== undefined && th.maxTempC > 0) {
    if (r.tempC >= th.maxTempC) issues.push({ code: "roomHot", severity: "high", value: r.tempC, limit: th.maxTempC });
    else if (r.tempC >= th.maxTempC - 5) issues.push({ code: "roomHot", severity: "warn", value: r.tempC, limit: th.maxTempC });
  }
  if (r.humidity !== undefined && th.maxHumidity !== undefined && th.maxHumidity > 0) {
    if (r.humidity >= th.maxHumidity) issues.push({ code: "roomHumid", severity: "high", value: r.humidity, limit: th.maxHumidity });
    else if (r.humidity >= th.maxHumidity - 10) issues.push({ code: "roomHumid", severity: "warn", value: r.humidity, limit: th.maxHumidity });
  }
  if (r.battery !== undefined && r.battery <= 15) {
    issues.push({ code: "sensorLowBattery", severity: "warn", value: r.battery, limit: 15 });
  }
  return issues;
}
