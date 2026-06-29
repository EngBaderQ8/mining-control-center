import type { DeviceDriver, Transport, ControlCommand } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parseResponse } from "../cgminer/parse";

interface SessionResponse {
  SESSION?: Array<{ SessionID?: string }>;
}

export class LuxOsDriver implements DeviceDriver {
  firmware = "luxos" as const;

  async execute(device: Device, command: ControlCommand, t: Transport): Promise<CommandOutcome> {
    try {
      const logon = await t.tcp4028(
        device.host,
        device.apiPort,
        JSON.stringify({ command: "logon" }),
      );
      const parsed = parseResponse(logon);
      const session =
        parsed.ok && Array.isArray((parsed.value as SessionResponse).SESSION)
          ? String((parsed.value as SessionResponse).SESSION?.[0]?.SessionID ?? "")
          : "";
      const send = (cmd: object): Promise<string> =>
        t.tcp4028(device.host, device.apiPort, JSON.stringify(cmd));
      switch (command) {
        case "stopMining":
          await send({ command: "curtail", parameter: `${session},sleep` });
          break;
        case "startMining":
          await send({ command: "curtail", parameter: `${session},wakeup` });
          break;
        case "restartMining":
          await send({ command: "curtail", parameter: `${session},wakeup` });
          break;
        case "reboot":
          await send({ command: "reboot", parameter: session });
          break;
      }
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
