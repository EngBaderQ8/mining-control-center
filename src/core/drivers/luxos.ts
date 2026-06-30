import type {
  DeviceDriver,
  Transport,
  ControlCommand,
  CommandParams,
  FlashTransport,
  FirmwareImage,
  FlashOutcome,
  FlashPhase,
} from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";
import { parseResponse } from "../cgminer/parse";
import { parsePools } from "./pools";

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
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
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
          // Add each provided pool (LuxOS has no atomic replace).
          for (const p of parsePools(params)) {
            r = await send({
              command: "addpool",
              parameter: `${session},${p.url},${p.user},${p.pass}`,
            });
            if (!r.ok) break;
          }
          break;
        }
        case "setProfile":
          return { deviceId: device.id, ok: false, error: "بروفايلات الطاقة غير مدعومة على LuxOS بعد" };
      }
      if (!r.ok) return { deviceId: device.id, ok: false, error: r.error };
      return { deviceId: device.id, ok: true };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }

  /**
   * LuxOS flash is PULL-based and the SAFEST path: no firmware bytes are pushed
   * over the wire. We `logon` for a session, then `updaterun` — the miner fetches
   * and verifies its OWN signed image, then reboots. `image.bytes` is empty (the
   * server sends no url/sha256 for luxos). A "no update available"/"already latest"
   * reply is a safe refusal, not a failure.
   */
  async flash(
    device: Device,
    _image: FirmwareImage,
    t: FlashTransport,
    _secret?: string,
    onProgress?: (phase: FlashPhase) => void,
  ): Promise<FlashOutcome> {
    try {
      onProgress?.("flashing");
      const logon = await t.tcp4028(device.host, device.apiPort, JSON.stringify({ command: "logon" }));
      const parsed = parseResponse(logon);
      const session =
        parsed.ok && Array.isArray((parsed.value as SessionResponse).SESSION)
          ? String((parsed.value as SessionResponse).SESSION?.[0]?.SessionID ?? "")
          : "";
      if (!session) return { ack: "failed", detail: parsed.ok ? "logon returned no SessionID" : parsed.error };

      const raw = await t.tcp4028(
        device.host,
        device.apiPort,
        JSON.stringify({ command: "updaterun", parameter: session }),
      );
      const r = parseResponse(raw);
      if (!r.ok) return { ack: "failed", detail: r.error };
      const st = (r.value as { STATUS?: Array<{ STATUS?: string; Msg?: string }> }).STATUS?.[0];
      if (st?.STATUS === "E" || st?.STATUS === "F") {
        const msg = String(st.Msg ?? "");
        if (/no update|already|latest|not available|up to date|unknown command|invalid/i.test(msg))
          return { ack: "refused", detail: msg };
        return { ack: "failed", detail: msg || "miner rejected updaterun" };
      }
      onProgress?.("rebooting");
      return { ack: "flashed" };
    } catch (e) {
      return { ack: "failed", detail: (e as Error).message };
    }
  }
}
