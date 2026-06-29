import type { ServerRepo } from "../db/repo";
import { hashPassword, verifyPassword } from "./password";
import { signToken } from "./jwt";

export type AuthResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; error: string };

export class AuthService {
  constructor(
    private repo: ServerRepo,
    private secret: string,
  ) {}

  async signup(email: string, password: string): Promise<AuthResult> {
    if (this.repo.findUserByEmail(email)) return { ok: false, error: "email already registered" };
    const userId = this.repo.createUser(email, await hashPassword(password));
    return { ok: true, token: signToken(userId, this.secret), userId };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = this.repo.findUserByEmail(email);
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return { ok: false, error: "invalid credentials" };
    return { ok: true, token: signToken(user.id, this.secret), userId: user.id };
  }
}
