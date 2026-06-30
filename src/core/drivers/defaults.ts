import type { Firmware } from "../model/device";

/**
 * Built-in default control credentials per firmware ("user:pass", or just a
 * password where the API takes one). Linked directly to the detected firmware so
 * miners left on factory defaults are controllable with ZERO configuration. A
 * user-set secret always overrides this. Empty string = that firmware's control
 * API needs no static password (cgminer session / open LAN API).
 */
const FIRMWARE_DEFAULT_SECRET: Record<Firmware, string> = {
  stock: "root:root", // Antminer stock web UI (Bitmain)
  braiins: "", // Braiins OS+ — cgminer-style API, no static auth on LAN
  vnish: "admin", // Vnish web API default unlock password
  luxos: "", // LuxOS — session via the `logon` API command, no static password
  whatsminer: "", // Whatsminer reads are plaintext; control needs the encrypted token API
};

/** The factory-default control secret for a firmware (used when none is set). */
export function firmwareDefaultSecret(firmware: Firmware): string {
  return FIRMWARE_DEFAULT_SECRET[firmware] ?? "root:root";
}

/**
 * Resolve the secret to use for a device: the user-set one if present, otherwise
 * the firmware's built-in default.
 */
export function resolveSecret(firmware: Firmware, userSecret?: string): string {
  return userSecret && userSecret.length > 0 ? userSecret : firmwareDefaultSecret(firmware);
}
