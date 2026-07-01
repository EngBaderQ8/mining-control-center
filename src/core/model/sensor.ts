/** A room climate sensor (Shelly) on a site's LAN, polled by that site's agent. */
export interface SensorConfig {
  id: string;
  siteId: string;
  name: string; // friendly label, e.g. "غرفة الحاويات"
  host: string; // LAN IP/host of the Shelly (agent reaches it, not the office PC)
  maxTempC?: number; // alert at/above this room temperature (°C)
  maxHumidity?: number; // alert at/above this relative humidity (%)
}

/** A sensor's latest reading (config + measured values), reported by the agent. */
export interface SensorReading extends SensorConfig {
  tempC?: number;
  humidity?: number; // %RH
  battery?: number; // % (battery models only)
  ok: boolean; // reached the sensor and parsed a value
  at: number; // epoch ms of the reading
  error?: string; // why the read failed (when !ok)
}
