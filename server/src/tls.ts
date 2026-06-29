import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "selfsigned";

/**
 * Load the server's TLS key/cert from `dir`, generating a long-lived
 * self-signed pair on first run. The cert fingerprint is what the app pins.
 */
export async function loadOrCreateTls(dir: string): Promise<{ key: string; cert: string }> {
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  if (existsSync(keyPath) && existsSync(certPath)) {
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  }
  const tenYears = new Date();
  tenYears.setFullYear(tenYears.getFullYear() + 10);
  const pems = await generate([{ name: "commonName", value: "mining-control-center" }], {
    notAfterDate: tenYears,
    keySize: 2048,
    algorithm: "sha256",
  });
  writeFileSync(keyPath, pems.private);
  writeFileSync(certPath, pems.cert);
  return { key: pems.private, cert: pems.cert };
}
