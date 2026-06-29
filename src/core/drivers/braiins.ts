import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

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
      await t.tcp4028(device.host, device.apiPort, JSON.stringify(payload));
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
