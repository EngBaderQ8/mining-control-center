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
import { parsePools } from "./pools";

/** Split a stored "user:pass" / bare-password secret into web-UI credentials. */
function creds(secret?: string): { user: string; pass: string } {
  const raw = secret ?? "root:root";
  const sep = raw.indexOf(":");
  return sep === -1 ? { user: "root", pass: raw } : { user: raw.slice(0, sep), pass: raw.slice(sep + 1) };
}

const PATH: Record<Exclude<ControlCommand, "setPool" | "setProfile" | "diagnose">, string> = {
  reboot: "/cgi-bin/reboot.cgi",
  restartMining: "/cgi-bin/miner_restart.cgi",
  stopMining: "/cgi-bin/miner_restart.cgi", // stock has no pause; honest restart fallback
  startMining: "/cgi-bin/miner_restart.cgi",
};

// Antminer stock work-mode value (experimental — exact codes vary by model/firmware).
const WORK_MODE: Record<string, string> = { normal: "0", lowpower: "1", highperf: "0" };

export class StockDriver implements DeviceDriver {
  firmware = "stock" as const;

  async execute(
    device: Device,
    command: ControlCommand,
    t: Transport,
    secret?: string,
    params?: CommandParams,
  ): Promise<CommandOutcome> {
    // "diagnose" is intercepted upstream (service.sendCommand) and never reaches a
    // driver; this guard makes that explicit and narrows the command type.
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
    // Accept either "user:pass" or a bare password. Split on the FIRST colon
    // only (so passwords containing ':' survive); with no colon the whole value
    // is the password and the user defaults to "root".
    const { user, pass } = creds(secret);
    try {
      // setPool posts the pool configuration to the miner config CGI; other
      // commands are simple GETs. Exact conf schema varies by model (see risks).
      const digest = { kind: "digest" as const, user, pass };
      const conf = "/cgi-bin/set_miner_conf.cgi";
      let req;
      if (command === "setPool") {
        req = {
          host: device.host,
          port: device.controlPort,
          method: "POST" as const,
          path: conf,
          auth: digest,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            pools: parsePools(params),
          }),
        };
      } else if (command === "setProfile") {
        // Experimental: post the power/work mode. Exact field/codes vary by model.
        req = {
          host: device.host,
          port: device.controlPort,
          method: "POST" as const,
          path: conf,
          auth: digest,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ "bitmain-work-mode": WORK_MODE[params?.["mode"] ?? "normal"] ?? "0" }),
        };
      } else {
        req = {
          host: device.host,
          port: device.controlPort,
          method: "GET" as const,
          path: PATH[command],
          auth: digest,
        };
      }

      const res = await t.http(req);
      return res.status >= 200 && res.status < 300
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: `HTTP ${res.status}` };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }

  /**
   * Antminer stock flash: multipart POST the signed `.tar.gz` (field `datafile`)
   * to /cgi-bin/upgrade.cgi with Digest auth. Stock firmware preserves the config
   * partition across a signed upgrade, so settings are kept automatically. The
   * bootloader signature check makes this SAFE: a wrong/tampered/unsigned image is
   * rejected (-> `refused`, device untouched), never half-written.
   */
  async flash(
    device: Device,
    image: FirmwareImage,
    t: FlashTransport,
    secret?: string,
    onProgress?: (phase: FlashPhase) => void,
  ): Promise<FlashOutcome> {
    const { user, pass } = creds(secret);
    try {
      onProgress?.("flashing");
      const res = await t.httpUpload({
        host: device.host,
        port: device.controlPort,
        path: "/cgi-bin/upgrade.cgi",
        auth: { kind: "digest", user, pass },
        files: [{ field: "datafile", filename: image.fileName, data: image.bytes }],
        timeoutMs: 300000,
      });
      const body = (res.body ?? "").toLowerCase();
      const ok = /success|successed|finish|complete|reboot/.test(body);
      const rejected =
        /signature|verify\s*fail|invalid\s*(file|image|firmware)|not\s*match|unsupported|wrong\s*(file|image)|bad\s*file/.test(
          body,
        );
      if (ok) {
        onProgress?.("rebooting");
        return { ack: "flashed" };
      }
      if (rejected) return { ack: "refused", detail: body.slice(0, 200) || `HTTP ${res.status}` };
      if (res.status === 401 || res.status === 403)
        return { ack: "refused", detail: `auth rejected (HTTP ${res.status})` };
      if (res.status >= 200 && res.status < 300) {
        // 2xx with no clear marker: assume accepted; the version read-back is the
        // real judge (an unchanged version after reboot is reported as failed).
        onProgress?.("rebooting");
        return { ack: "flashed" };
      }
      return { ack: "failed", detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ack: "failed", detail: (e as Error).message };
    }
  }
}
