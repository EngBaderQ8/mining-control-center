import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

const VERB: Record<ControlCommand, string> = {
  stopMining: "pause",
  startMining: "resume",
  restartMining: "restart",
  reboot: "reboot",
};

export class BraiinsDriver implements DeviceDriver {
  firmware = "braiins" as const;

  async execute(device: Device, command: ControlCommand, t: Transport): Promise<CommandOutcome> {
    try {
      await t.tcp4028(device.host, device.apiPort, JSON.stringify({ command: VERB[command] }));
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
