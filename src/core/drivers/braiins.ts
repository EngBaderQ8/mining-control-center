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

/** Pull the LuCI `sysauth*` session cookie out of a Set-Cookie header value
 *  (the http transport joins multiple cookies with ", "). */
function sessionCookie(setCookie?: string): string {
  const m = /(sysauth\w*=[^;,\s]+)/i.exec(setCookie ?? "");
  return m ? m[1]! : "";
}

const VERB: Record<Exclude<ControlCommand, "setPool" | "setProfile" | "diagnose">, string> = {
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
    if (command === "diagnose") return { deviceId: device.id, ok: false, error: "diagnose handled by agent" };
    if (command === "setProfile")
      return { deviceId: device.id, ok: false, error: "بروفايلات الطاقة غير مدعومة على Braiins بعد" };
    try {
      const send = async (payload: object): Promise<{ ok: boolean; error?: string }> => {
        const raw = await t.tcp4028(device.host, device.apiPort, JSON.stringify(payload));
        const parsed = parseResponse(raw);
        const st = parsed.ok
          ? (parsed.value as { STATUS?: Array<{ STATUS?: string; Msg?: string }> }).STATUS?.[0]
          : undefined;
        if (st && (st.STATUS === "E" || st.STATUS === "F"))
          return { ok: false, error: String(st.Msg ?? "miner rejected command") };
        return { ok: true };
      };
      if (command === "setPool") {
        // Braiins has no atomic "replace pools"; add each provided pool in order.
        const pools = parsePools(params);
        for (const p of pools) {
          const r = await send({ command: "addpool", parameter: `${p.url},${p.user},${p.pass}` });
          if (!r.ok) return { deviceId: device.id, ok: false, error: r.error };
        }
        return { deviceId: device.id, ok: true };
      }
      const r = await send({ command: VERB[command] });
      return r.ok
        ? { deviceId: device.id, ok: true }
        : { deviceId: device.id, ok: false, error: r.error };
    } catch (e) {
      return { deviceId: device.id, ok: false, error: (e as Error).message };
    }
  }

  /**
   * Braiins OS+ in-place upgrade via the LuCI web UI: (1) log in for a session
   * cookie, (2) scrape the CSRF token from the flashops page, (3) multipart-POST
   * the `.tar.gz` (field `image`) to the sysupgrade endpoint, with `keep=1` to
   * preserve settings. Braiins images are signed, so a wrong/tampered image is
   * rejected (-> `refused`) rather than half-written. The secret is the web
   * password (user is always `root` on Braiins).
   */
  async flash(
    device: Device,
    image: FirmwareImage,
    t: FlashTransport,
    secret?: string,
    onProgress?: (phase: FlashPhase) => void,
  ): Promise<FlashOutcome> {
    const raw = secret ?? "root";
    const sep = raw.indexOf(":");
    const pass = sep === -1 ? raw : raw.slice(sep + 1); // accept "root:pass" or bare pass
    const base = { host: device.host, port: device.controlPort };
    try {
      onProgress?.("flashing");
      // 1) Log in -> session cookie.
      const login = await t.http({
        ...base,
        method: "POST",
        path: "/cgi-bin/luci",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `luci_username=root&luci_password=${encodeURIComponent(pass)}`,
      });
      const cookie = sessionCookie(login.headers?.["set-cookie"]);
      if (!cookie) return { ack: "refused", detail: "تعذّر تسجيل الدخول إلى LuCI (كلمة مرور خاطئة؟)" };

      // 2) Scrape the CSRF token from the flashops page.
      const page = await t.http({
        ...base,
        method: "GET",
        path: "/cgi-bin/luci/admin/system/flashops",
        headers: { cookie },
      });
      const token =
        /name="token"\s+value="([0-9a-fA-F]+)"/.exec(page.body)?.[1] ??
        /token['":\s]+([0-9a-fA-F]{16,})/.exec(page.body)?.[1] ??
        "";
      if (!token) return { ack: "failed", detail: "تعذّر الحصول على رمز CSRF من LuCI" };

      // 3) Upload the image (keep settings if requested).
      const res = await t.httpUpload({
        ...base,
        path: "/cgi-bin/luci/admin/system/flashops/sysupgrade",
        headers: { cookie },
        fields: { token, keep: image.keepSettings ? "1" : "0" },
        files: [{ field: "image", filename: image.fileName, data: image.bytes }],
        timeoutMs: 300000,
      });
      const body = (res.body ?? "").toLowerCase();
      const rejected =
        /invalid|not\s*supported|bad\s*(file|image)|signature|incompatible|wrong/.test(body) &&
        !/flashing|sysupgrade|rebooting|will reboot/.test(body);
      if (rejected) return { ack: "refused", detail: body.slice(0, 200) };
      if (res.status >= 200 && res.status < 400) {
        onProgress?.("rebooting");
        return { ack: "flashed" };
      }
      return { ack: "failed", detail: `HTTP ${res.status}` };
    } catch (e) {
      return { ack: "failed", detail: (e as Error).message };
    }
  }
}
