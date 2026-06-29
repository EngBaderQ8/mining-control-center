import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const PATH: Record<Exclude<ControlCommand, "setPool">, string> = {
  reboot: "/cgi-bin/reboot.cgi",
  restartMining: "/cgi-bin/miner_restart.cgi",
  stopMining: "/cgi-bin/miner_restart.cgi", // stock has no pause; honest restart fallback
  startMining: "/cgi-bin/miner_restart.cgi",
};

export class StockDriver implements DeviceDriver {
  firmware = "stock" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
    // Split on the FIRST colon only so passwords containing ':' survive intact.
    const rawSecret = secret ?? "root:root";
    const sep = rawSecret.indexOf(":");
    const user = sep === -1 ? rawSecret : rawSecret.slice(0, sep);
    const pass = sep === -1 ? "" : rawSecret.slice(sep + 1);
    try {
      // setPool posts the pool configuration to the miner config CGI; other
      // commands are simple GETs. Exact conf schema varies by model (see risks).
      const req =
        command === "setPool"
          ? {
              host: device.host,
              port: device.controlPort,
              method: "POST" as const,
              path: "/cgi-bin/set_miner_conf.cgi",
              auth: { kind: "digest" as const, user, pass },
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                pools: [
                  {
                    url: params?.["url"] ?? "",
                    user: params?.["user"] ?? "",
                    pass: params?.["pass"] ?? "",
                  },
                ],
              }),
            }
          : {
              host: device.host,
              port: device.controlPort,
              method: "GET" as const,
              path: PATH[command],
              auth: { kind: "digest" as const, user, pass },
            };

      const res = await t.http(req);
      return res.status >= 200 && res.status < 300
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
