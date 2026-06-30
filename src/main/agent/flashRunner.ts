import { createHash } from "node:crypto";
import type { FlashExec, FlashProgress, FlashResult } from "../../shared/protocol";
import type { Device } from "../../core/model/device";
import type { FlashTransport, FirmwareImage, FlashPhase } from "../../core/drivers/types";
import { getDriver } from "../../core/drivers/registry";
import { detectFromVersion } from "../../core/discovery/detect";

/** Everything the runner needs, injected so the orchestration logic is testable
 *  without real network / Node http. */
export interface FlashRunnerDeps {
  transport: FlashTransport;
  findDevice: (deviceId: string) => Device | undefined;
  getSecret: (deviceId: string) => string | undefined;
  /** Pull the firmware file from the owner's server (returns empty Buffer on failure). */
  download: (url: string) => Promise<Buffer>;
  /** Read the live `version` reply over tcp4028 (rejects/throws when the device is down). */
  readVersion: (device: Device) => Promise<string>;
  send: (m: FlashProgress | FlashResult) => void;
  /** Override the post-reboot wait (tests inject a no-op). */
  delay?: (ms: number) => Promise<void>;
}

const sha256Hex = (b: Buffer): string => createHash("sha256").update(b).digest("hex");

/** Same normalised contains-match the server uses (kept local: core can't import server/). */
function modelMatches(deviceModel: string, fwModel: string): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();
  const d = norm(deviceModel);
  const f = norm(fwModel);
  if (!d || !f) return false;
  return d === f || d.includes(f) || f.includes(d);
}

/** Pull a short version-ish token out of a cgminer/bmminer `version` reply, for the
 *  read-back proof shown in the dashboard. */
function shortVersion(raw: string): string {
  const clean = raw.replace(/\0/g, "");
  const m =
    /"(?:fw_ver|CompileTime|Version|prod|BMMiner|LUXminer|BOSminer|LUXminerVersion)"\s*:\s*"([^"]+)"/i.exec(
      clean,
    );
  return (m?.[1] ?? "").slice(0, 60) || "محدّثة";
}

// Post-reboot read-back: poll up to ~3 min (20 × 9s) for the device to come back.
const CONFIRM_TRIES = 20;
const CONFIRM_INTERVAL_MS = 9000;

/**
 * Run ONE firmware-flash job end-to-end and report progress + a single terminal
 * result. Order is safety-first: download → sha256 verify → live model/firmware
 * re-check → driver flash → version read-back. Anything before the driver flash
 * that fails leaves the device UNTOUCHED (refused/failed with no bytes pushed).
 */
export async function runFlash(msg: FlashExec, deps: FlashRunnerDeps): Promise<void> {
  const progress = (phase: FlashPhase): void =>
    deps.send({ type: "flash.progress", jobId: msg.jobId, deviceId: msg.deviceId, phase });
  const result = (
    state: FlashResult["state"],
    extra?: { newVersion?: string; error?: string },
  ): void => deps.send({ type: "flash.result", jobId: msg.jobId, deviceId: msg.deviceId, state, ...extra });

  const device = deps.findDevice(msg.deviceId);
  if (!device) return result("failed", { error: "الجهاز غير موجود على هذا الوكيل" });

  const driver = getDriver(msg.family);
  if (!driver.flash) return result("refused", { error: `الفلاش غير مدعوم لنوع الفِرموير: ${msg.family}` });

  try {
    const isLux = msg.family === "luxos"; // luxos pulls its own image — no byte push
    let bytes: Buffer = Buffer.alloc(0);

    // 1) Download + 2) verify sha256 (skipped for luxos). The sha256 is authoritative:
    //    it rode the authenticated, cert-pinned WS channel from the owner's server.
    if (!isLux) {
      progress("downloading");
      bytes = await deps.download(msg.url);
      if (bytes.length === 0) return result("failed", { error: "فشل تنزيل ملف الفِرموير من الخادم" });
      progress("verifying");
      if (sha256Hex(bytes).toLowerCase() !== (msg.sha256 || "").toLowerCase())
        return result("failed", { error: "تجزئة SHA-256 لا تطابق — أُلغيت العملية" });
    }

    // 3) Match: the LIVE device must still be the expected firmware + model. Capture
    //    the pre-flash version so the read-back can prove the firmware actually changed.
    progress("matching");
    const preVer = await deps.readVersion(device).catch(() => "");
    const detected = preVer ? detectFromVersion(preVer) : null;
    if (!detected) return result("failed", { error: "تعذّر قراءة نسخة الجهاز قبل الفلاش" });
    if (detected.firmware !== msg.family)
      return result("refused", {
        error: `نوع الفِرموير الحالي (${detected.firmware}) لا يطابق المطلوب (${msg.family})`,
      });
    if (!modelMatches(detected.model, msg.model))
      return result("refused", { error: `موديل الجهاز (${detected.model}) لا يطابق (${msg.model})` });

    // 4) Flash (device-specific; the driver reports flashing/rebooting progress).
    const image: FirmwareImage = {
      family: msg.family,
      model: msg.model,
      fileName: msg.url.split("/").pop() || "firmware.bin",
      bytes,
      keepSettings: msg.keepSettings,
    };
    const outcome = await driver.flash(device, image, deps.transport, deps.getSecret(msg.deviceId), progress);
    if (outcome.ack === "refused") return result("refused", { error: outcome.detail ?? "رفض الجهاز الصورة" });
    if (outcome.ack === "failed") return result("failed", { error: outcome.detail ?? "فشل الفلاش" });

    // 5) Confirm: wait for the reboot, then read the new version. Success REQUIRES
    //    the version to have changed — an unchanged version means it didn't take.
    progress("confirming");
    const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let newVer = "";
    for (let i = 0; i < CONFIRM_TRIES; i++) {
      await delay(CONFIRM_INTERVAL_MS);
      newVer = await deps.readVersion(device).catch(() => "");
      if (newVer && newVer !== preVer) break;
    }
    if (!newVer) return result("failed", { error: "لم يعد الجهاز بعد إعادة التشغيل (احتمال تلف)" });
    if (newVer === preVer) return result("failed", { error: "النسخة لم تتغيّر — لم يُطبَّق التحديث" });
    return result("success", { newVersion: shortVersion(newVer) });
  } catch (e) {
    return result("failed", { error: (e as Error).message });
  }
}
