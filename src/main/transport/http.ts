import { request } from "undici";
import { createHash, randomBytes } from "node:crypto";
import type {
  HttpRequest,
  HttpResponse,
  HttpUploadRequest,
  UploadFile,
} from "../../core/drivers/types";

const md5 = (s: string): string => createHash("md5").update(s).digest("hex");

function buildUrl(req: HttpRequest): string {
  const scheme = req.scheme ?? (req.port === 443 ? "https" : "http");
  return `${scheme}://${req.host}:${req.port}${req.path}`;
}

function baseHeaders(req: HttpRequest): Record<string, string> {
  const h: Record<string, string> = { ...(req.headers ?? {}) };
  if (req.auth?.kind === "bearer" && req.auth.token) h["authorization"] = `Bearer ${req.auth.token}`;
  if (req.auth?.kind === "basic")
    h["authorization"] =
      "Basic " + Buffer.from(`${req.auth.user ?? ""}:${req.auth.pass ?? ""}`).toString("base64");
  return h;
}

/** Parse a `WWW-Authenticate: Digest ...` challenge into a key/value map. */
export function parseChallenge(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = header.replace(/^Digest\s+/i, "");
  for (const part of body.match(/(\w+)=(?:"([^"]*)"|([^,]*))/g) ?? []) {
    const m = /(\w+)=(?:"([^"]*)"|([^,]*))/.exec(part);
    if (m) out[m[1]!] = m[2] ?? m[3] ?? "";
  }
  return out;
}

export function digestHeader(req: HttpRequest, challenge: Record<string, string>): string {
  const user = req.auth?.user ?? "";
  const pass = req.auth?.pass ?? "";
  const realm = challenge["realm"] ?? "";
  const nonce = challenge["nonce"] ?? "";
  const qop = challenge["qop"];
  const opaque = challenge["opaque"];
  const uri = req.path;
  const nc = "00000001";
  const cnonce = randomBytes(8).toString("hex");
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${req.method}:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  let h =
    `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", ` +
    `response="${response}"`;
  if (qop) h += `, qop=auth, nc=${nc}, cnonce="${cnonce}"`;
  if (opaque) h += `, opaque="${opaque}"`;
  return h;
}

async function send(
  url: string,
  method: HttpRequest["method"],
  headers: Record<string, string>,
  body?: string,
): Promise<HttpResponse> {
  const res = await request(url, { method, headers, body });
  const text = await res.body.text();
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers)) flat[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  return { status: res.statusCode, body: text, headers: flat };
}

export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const url = buildUrl(req);

  if (req.auth?.kind === "digest") {
    // First unauthenticated request to obtain the digest challenge.
    const first = await send(url, req.method, { ...(req.headers ?? {}) }, req.body);
    if (first.status !== 401) return first;
    const wwwAuth = first.headers?.["www-authenticate"] ?? "";
    const challenge = parseChallenge(wwwAuth);
    const headers = { ...(req.headers ?? {}), authorization: digestHeader(req, challenge) };
    return send(url, req.method, headers, req.body);
  }

  return send(url, req.method, baseHeaders(req), req.body);
}

// ——— Binary multipart upload (firmware flashing) ———

const CRLF = "\r\n";

/** Build a multipart/form-data body Buffer (text fields first, then binary files).
 *  Exported for unit testing — the structure must be byte-exact for picky CGIs. */
export function multipartBody(
  boundary: string,
  fields: Record<string, string>,
  files: UploadFile[],
): Buffer {
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}${value}${CRLF}`,
      ),
    );
  }
  for (const f of files) {
    const ct = f.contentType ?? "application/octet-stream";
    parts.push(
      Buffer.from(
        `--${boundary}${CRLF}Content-Disposition: form-data; name="${f.field}"; ` +
          `filename="${f.filename}"${CRLF}Content-Type: ${ct}${CRLF}${CRLF}`,
      ),
    );
    parts.push(f.data);
    parts.push(Buffer.from(CRLF));
  }
  parts.push(Buffer.from(`--${boundary}--${CRLF}`));
  return Buffer.concat(parts);
}

async function sendBuffer(
  url: string,
  headers: Record<string, string>,
  body: Buffer,
  timeoutMs: number,
): Promise<HttpResponse> {
  const res = await request(url, {
    method: "POST",
    headers,
    body,
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
  const text = await res.body.text();
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(res.headers))
    flat[k] = Array.isArray(v) ? v.join(", ") : String(v ?? "");
  return { status: res.statusCode, body: text, headers: flat };
}

/**
 * POST a multipart/form-data body with a binary file part. Supports the same auth
 * kinds as httpRequest. For digest, a cheap PRIMER GET fetches the challenge so the
 * (possibly hundreds-of-MB) firmware body is uploaded only ONCE — never twice.
 */
export async function httpUpload(req: HttpUploadRequest): Promise<HttpResponse> {
  const scheme = req.scheme ?? (req.port === 443 ? "https" : "http");
  const url = `${scheme}://${req.host}:${req.port}${req.path}`;
  const boundary = `----mcc${randomBytes(16).toString("hex")}`;
  const body = multipartBody(boundary, req.fields ?? {}, req.files);
  const baseH: Record<string, string> = {
    ...(req.headers ?? {}),
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  };
  const timeout = req.timeoutMs ?? 240000;

  if (req.auth?.kind === "digest") {
    // Primer GET on the SAME path to obtain the digest challenge (nonce). Uploading
    // nothing here keeps the big body off this round-trip.
    const primer = await request(url, { method: "GET", headers: { ...(req.headers ?? {}) } });
    await primer.body.text();
    if (primer.statusCode === 401) {
      const wwwAuth = primer.headers["www-authenticate"];
      const challenge = parseChallenge(Array.isArray(wwwAuth) ? wwwAuth[0] ?? "" : String(wwwAuth ?? ""));
      const authHeader = digestHeader(
        { method: "POST", path: req.path, auth: req.auth } as HttpRequest,
        challenge,
      );
      return sendBuffer(url, { ...baseH, authorization: authHeader }, body, timeout);
    }
    // No auth required (or an unexpected status) — just POST the body.
    return sendBuffer(url, baseH, body, timeout);
  }

  const headers = { ...baseH };
  if (req.auth?.kind === "bearer" && req.auth.token) headers["authorization"] = `Bearer ${req.auth.token}`;
  if (req.auth?.kind === "basic")
    headers["authorization"] =
      "Basic " + Buffer.from(`${req.auth.user ?? ""}:${req.auth.pass ?? ""}`).toString("base64");
  return sendBuffer(url, headers, body, timeout);
}
