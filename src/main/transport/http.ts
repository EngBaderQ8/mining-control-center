import { request } from "undici";
import { createHash, randomBytes } from "node:crypto";
import type { HttpRequest, HttpResponse } from "../../core/drivers/types";

const md5 = (s: string): string => createHash("md5").update(s).digest("hex");

function buildUrl(req: HttpRequest): string {
  const scheme = req.port === 443 ? "https" : "http";
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
