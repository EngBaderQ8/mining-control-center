import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthService } from "../auth/service";

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        resolve({});
      }
    });
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
