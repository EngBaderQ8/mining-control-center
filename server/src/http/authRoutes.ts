import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService } from "../auth/service";

const MAX_AUTH_BODY = 64 * 1024; // 64 KB — auth bodies are tiny; cap to prevent DoS

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const done = (val: unknown): void => {
      if (settled) return;
      settled = true;
      req.removeAllListeners("data");
      req.removeAllListeners("end");
      req.removeAllListeners("error");
      req.removeAllListeners("aborted");
      req.removeAllListeners("close");
      resolve(val);
    };
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_AUTH_BODY) {
        req.destroy();
        done({}); // oversized -> handleAuth's email/password check returns 400
        return;
      }
      chunks.push(Buffer.from(c));
    });
    req.on("end", () => {
      // Decode once after all chunks: multibyte (Arabic) sequences split across
      // TCP chunks are reassembled before UTF-8 decoding.
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        done({});
      }
    });
    // Always settle so handleAuth never hangs and the connection isn't leaked.
    req.on("error", () => done({}));
    req.on("aborted", () => done({}));
    req.on("close", () => done({}));
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

/**
 * Handle POST /auth/signup and /auth/login. Returns true if it handled the
 * request, false otherwise (so the caller can fall through to other routes).
 */
export async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  auth: AuthService,
): Promise<boolean> {
  if (req.method !== "POST") return false;
  const isSignup = req.url === "/auth/signup";
  const isLogin = req.url === "/auth/login";
  if (!isSignup && !isLogin) return false;

  const body = (await readJson(req)) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    send(res, 400, { error: "email and password required" });
    return true;
  }
  const result = isSignup
    ? await auth.signup(body.email, body.password)
    : await auth.login(body.email, body.password);

  if (result.ok) send(res, 200, { token: result.token, userId: result.userId });
  else send(res, isSignup ? 409 : 401, { error: result.error });
  return true;
}
