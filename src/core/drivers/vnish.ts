import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const PATHS: Record<Exclude<ControlCommand, "setPool" | "setProfile" | "diagnose">, string> = {
  restartMining: "/api/v1/mining/restart",
  stopMining: "/api/v1/mining/pause",
  startMining: "/api/v1/mining/resume",
  reboot: "/api/v1/system/reboot",
};

export class VnishDriver implements DeviceDriver {
  firmware = "vnish" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
    if (command === "setProfile")
      return { deviceId: device.id, ok: false, error: "بروفايلات الطاقة غير مدعومة على Vnish بعد" };
    try {
      // Vnish unlock takes the PASSWORD only. Accept a bare password or a
      // "user:pass" string (shared credential format) and use just the password.
      const raw = secret ?? "";
      const pw = raw.includes(":") ? raw.slice(raw.indexOf(":") + 1) : raw;
      const unlock = await t.http({
        host: device.host,
        port: device.controlPort,
        method: "POST",
        path: "/api/v1/unlock",
        body: JSON.stringify({ pw }),
        headers: { "content-type": "application/json" },
      });
      if (unlock.status < 200 || unlock.status >= 300)
        return { deviceId: device.id, ok: false, error: `unlock failed: HTTP ${unlock.status}` };
      let token = "";
      try {
        token = String((JSON.parse(unlock.body || "{}") as { token?: string }).token ?? "");
      } catch {
        return { deviceId: device.id, ok: false, error: "unlock returned invalid response" };
      }
      if (!token)
        return { deviceId: device.id, ok: false, error: "unlock returned no token (check credentials)" };

      const req =
        command === "setPool"
          ? {
              host: device.host,
              port: device.controlPort,
              method: "POST" as const,
              path: "/api/v1/settings/pools",
              auth: { kind: "bearer" as const, token },
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
              method: "POST" as const,
              path: PATHS[command],
              auth: { kind: "bearer" as const, token },
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
