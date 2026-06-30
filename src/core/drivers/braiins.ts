import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parseResponse } from "../cgminer/parse";
import { parsePools } from "./pools";

const VERB: Record<Exclude<ControlCommand, "setPool" | "setProfile" | "diagnose">, string> = {
  stopMining: "pause",
  startMining: "resume",
  restartMining: "restart",
  reboot: "reboot",
};

export class BraiinsDriver implements DeviceDriver {
  firmware = "braiins" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    _secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
    if (command === "setProfile")
      return { deviceId: device.id, ok: false, error: "بروفايلات الطاقة غير مدعومة على Braiins بعد" };
    try {
      const send = async (payload: object): Promise<{ ok: boolean; error?: string }> => {
        const raw = await t.tcp4028(device.host, device.apiPort, JSON.stringify(payload));
        const parsed = parseResponse(raw);
        const st = parsed.ok
          ? (parsed.value as { STATUS?: Array<{ STATUS?: string; Msg?: string }> }).STATUS?.[0]
          : undefined;
        if (st && (st.STATUS === "E" || st.STATUS === "F"))
          return { ok: false, error: String(st.Msg ?? "miner rejected command") };
        return { ok: true };
      };
      if (command === "setPool") {
        // Braiins has no atomic "replace pools"; add each provided pool in order.
        const pools = parsePools(params);
        for (const p of pools) {
          const r = await send({ command: "addpool", parameter: `${p.url},${p.user},${p.pass}` });
          if (!r.ok) return { deviceId: device.id, ok: false, error: r.error };
        }
        return { deviceId: device.id, ok: true };
      }
      const r = await send({ command: VERB[command] });
      return r.ok
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: r.error };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
