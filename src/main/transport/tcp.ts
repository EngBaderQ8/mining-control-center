import { createConnection } from "node:net";

/**
 * Real cgminer 4028 transport: connect, write the command, accumulate the
 * response until the miner closes the socket, with a hard timeout.
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
    const fail = (e: Error): void => {
      if (settled) return;
      settled = true;
      sock.destroy();
      reject(e);
    };
    sock.setTimeout(timeoutMs, () => fail(new Error("timeout")));
    sock.on("connect", () => sock.write(command));
    sock.on("data", (c) => (data += c.toString("utf8")));
    sock.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(data);
    });
    sock.on("close", () => {
      if (settled) return;
      settled = true;
      resolve(data);
    });
    sock.on("error", fail);
  });
}
