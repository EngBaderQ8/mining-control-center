import { safeStorage } from "electron";

/**
 * Credential encryption backed by the OS keystore (Windows DPAPI via Electron's
 * safeStorage). Only available in the Electron main process at runtime; verified
 * manually in Milestone 8 rather than unit-tested.
 */
export function encryptSecret(plain: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS encryption unavailable");
  return safeStorage.encryptString(plain);
}

export function decryptSecret(enc: Buffer): string {
  return safeStorage.decryptString(enc);
}
