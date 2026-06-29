import { createConnection } from "node:net";

/** True once the buffer looks like a complete cgminer reply (a JSON object/array
 *  end). We don't require strictly-valid JSON — bmminer sometimes emits slightly
 *  malformed JSON, and we still want to capture and use it. */
function looksComplete(raw: string): boolean {
  const trimmed = raw.replace(/\0/g, "").trim();
  return trimmed.length > 1 && (trimmed.endsWith("}") || trimmed.endsWith("]"));
}

/**
 * Real cgminer 4028 transport: connect, write the command, accumulate the
 * response, and resolve as soon as a complete JSON reply arrives (some firmware
 * keeps the socket open), or when the miner closes it — whichever comes first.
 */
export function tcp4028(
  host: string,
  port: number,
  command: string,
  timeoutMs = 5000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port });
    let data = "";
    let settled = false;
    const done = (value: string): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(value);
    };
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(e);
    };
    sock.setTimeout(timeoutMs, () => fail(new Error("timeout")));
    sock.on("connect", () => sock.write(command));
    sock.on("data", (c) => {
      data += c.toString("utf8");
      if (looksComplete(data)) done(data);
    });
    sock.on("end", () => done(data));
    sock.on("close", () => done(data));
    sock.on("error", fail);
  });
}

export interface HostDiagnosis {
  connected: boolean;
  gotData: boolean;
  raw: string;
  error?: string;
}

/** Probe a single host on 4028 with detailed step-by-step results (for debugging). */
export function diagnoseHost(host: string, port = 4028, timeoutMs = 3000): Promise<HostDiagnosis> {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port });
    let raw = "";
    let connected = false;
    let settled = false;
    const finish = (extra?: string): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ connected, gotData: raw.length > 0, raw, ...(extra ? { error: extra } : {}) });
    };
    sock.setTimeout(timeoutMs, () => finish(connected ? "اتصل لكن ما ردّ (timeout)" : "ما قدر يتصل (timeout)"));
    sock.on("connect", () => {
      connected = true;
      sock.write(JSON.stringify({ command: "version" }));
    });
    sock.on("data", (c) => {
      raw += c.toString("utf8");
      if (looksComplete(raw)) finish();
    });
    sock.on("end", () => finish());
    sock.on("close", () => finish());
    sock.on("error", (e) => finish(e.message));
  });
}
