import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parseResponse } from "../cgminer/parse";

const VERB: Record<Exclude<ControlCommand, "setPool">, string> = {
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
    try {
      const payload =
        command === "setPool"
          ? {
              command: "addpool",
              parameter: `${params?.["url"] ?? ""},${params?.["user"] ?? ""},${params?.["pass"] ?? ""}`,
            }
          : { command: VERB[command] };
      const raw = await t.tcp4028(device.host, device.apiPort, JSON.stringify(payload));
      const parsed = parseResponse(raw);
      const st = parsed.ok
        ? (parsed.value as { STATUS?: Array<{ STATUS?: string; Msg?: string }> }).STATUS?.[0]
        : undefined;
      if (st && (st.STATUS === "E" || st.STATUS === "F"))
        return { deviceId: device.id, ok: false, error: String(st.Msg ?? "miner rejected command") };
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
