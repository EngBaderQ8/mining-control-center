import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parseResponse } from "../cgminer/parse";

interface SessionResponse {
  SESSION?: Array<{ SessionID?: string }>;
}

export class LuxOsDriver implements DeviceDriver {
  firmware = "luxos" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    _secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
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
      if (!session) {
        return {
          deviceId: device.id,
          ok: false,
          error: parsed.ok ? "logon returned no SessionID" : parsed.error,
        };
      }
      // Validate each reply: a non-success cgminer STATUS means the miner
      // rejected the command — don't report success blindly.
      const send = async (cmd: object): Promise<{ ok: boolean; error?: string }> => {
        const raw = await t.tcp4028(device.host, device.apiPort, JSON.stringify(cmd));
        const p = parseResponse(raw);
        if (!p.ok) return { ok: false, error: p.error };
        const st = (p.value as { STATUS?: Array<{ STATUS?: string; Msg?: string }> }).STATUS?.[0];
        if (st?.STATUS === "E" || st?.STATUS === "F")
          return { ok: false, error: String(st.Msg ?? "miner rejected command") };
        return { ok: true };
      };
      let r: { ok: boolean; error?: string } = { ok: true };
      switch (command) {
        case "stopMining":
          r = await send({ command: "curtail", parameter: `${session},sleep` });
          break;
        case "startMining":
          r = await send({ command: "curtail", parameter: `${session},wakeup` });
          break;
        case "restartMining":
          r = await send({ command: "curtail", parameter: `${session},wakeup` });
          break;
        case "reboot":
          r = await send({ command: "reboot", parameter: session });
          break;
        case "setPool": {
          const p = params ?? {};
          r = await send({
            command: "addpool",
            parameter: `${session},${p["url"] ?? ""},${p["user"] ?? ""},${p["pass"] ?? ""}`,
          });
          break;
        }
      }
      if (!r.ok) return { deviceId: device.id, ok: false, error: r.error };
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }
}
