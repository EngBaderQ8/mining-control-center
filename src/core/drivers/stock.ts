import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parsePools } from "./pools";

const PATH: Record<Exclude<ControlCommand, "setPool" | "setProfile" | "diagnose">, string> = {
  reboot: "/cgi-bin/reboot.cgi",
  restartMining: "/cgi-bin/miner_restart.cgi",
  stopMining: "/cgi-bin/miner_restart.cgi", // stock has no pause; honest restart fallback
  startMining: "/cgi-bin/miner_restart.cgi",
};

// Antminer stock work-mode value (experimental — exact codes vary by model/firmware).
const WORK_MODE: Record<string, string> = { normal: "0", lowpower: "1", highperf: "0" };

export class StockDriver implements DeviceDriver {
  firmware = "stock" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
    // "diagnose" is intercepted upstream (service.sendCommand) and never reaches a
    // driver; this guard makes that explicit and narrows the command type.
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
    // Accept either "user:pass" or a bare password. Split on the FIRST colon
    // only (so passwords containing ':' survive); with no colon the whole value
    // is the password and the user defaults to "root".
    const rawSecret = secret ?? "root:root";
    const sep = rawSecret.indexOf(":");
    const user = sep === -1 ? "root" : rawSecret.slice(0, sep);
    const pass = sep === -1 ? rawSecret : rawSecret.slice(sep + 1);
    try {
      // setPool posts the pool configuration to the miner config CGI; other
      // commands are simple GETs. Exact conf schema varies by model (see risks).
      const digest = { kind: "digest" as const, user, pass };
      const conf = "/cgi-bin/set_miner_conf.cgi";
      let req;
      if (command === "setPool") {
        req = {
          host: device.host,
          port: device.controlPort,
          method: "POST" as const,
          path: conf,
          auth: digest,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pools: parsePools(params),
          }),
        };
      } else if (command === "setProfile") {
        // Experimental: post the power/work mode. Exact field/codes vary by model.
        req = {
          host: device.host,
          port: device.controlPort,
          method: "POST" as const,
          path: conf,
          auth: digest,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ "bitmain-work-mode": WORK_MODE[params?.["mode"] ?? "normal"] ?? "0" }),
        };
      } else {
        req = {
          host: device.host,
          port: device.controlPort,
          method: "GET" as const,
          path: PATH[command],
          auth: digest,
        };
      }

      const res = await t.http(req);
      return res.status >= 200 && res.status < 300
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
