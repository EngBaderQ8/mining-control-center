import type { DeviceDriver, Transport, ControlCommand, CommandParams } from "./types";
import type { Device } from "../model/device";
import type { CommandOutcome } from "../model/result";

/**
 * MicroBT Whatsminer (btminer). MONITORING works through the firmware-agnostic
 * poller (plaintext cgminer `summary` on 4028). CONTROL (reboot/setPool/power)
 * requires Whatsminer's ENCRYPTED token API (get_token + AES-256-ECB), which
 * isn't implemented yet — so control ops report "not supported" cleanly rather
 * than silently failing through the Antminer path.
 */
export class WhatsminerDriver implements DeviceDriver {
  firmware = "whatsminer" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    _t: Transport,
    _secret?: string,
    _params?: CommandParams,
  ): Promise<CommandOutcome> {
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
    return {
      deviceId: device.id,
      ok: false,
      error: "أوامر التحكم على Whatsminer غير مدعومة بعد (تحتاج API مشفّر)",
    };
  }
}
