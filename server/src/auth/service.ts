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

  // Canonical email — lowercase + trim. Prevents case/whitespace variants from
  // creating a second account (and, critically, from matching an admin email).
  private canon(email: string): string {
    return email.trim().toLowerCase();
  }

  async signup(email: string, password: string): Promise<AuthResult> {
    const e = this.canon(email);
    if (this.repo.findUserByEmail(e)) return { ok: false, error: "email already registered" };
    const userId = this.repo.createUser(e, await hashPassword(password));
    return { ok: true, token: signToken(userId, this.secret), userId };
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = this.repo.findUserByEmail(this.canon(email));
    if (!user || !(await verifyPassword(password, user.passwordHash)))
      return { ok: false, error: "invalid credentials" };
    if (user.suspended) return { ok: false, error: "الحساب موقوف — تواصل مع الدعم" };
    return { ok: true, token: signToken(user.id, this.secret), userId: user.id };
  }
}
