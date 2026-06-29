import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applySchema } from "../../../server/src/db/schema";
import { ServerRepo } from "../../../server/src/db/repo";
import { AuthService } from "../../../server/src/auth/service";

function svc(): AuthService {
  const db = new Database(":memory:");
  applySchema(db);
  return new AuthService(new ServerRepo(db), "test-secret");
}

describe("AuthService", () => {
  it("signs up then logs in, issuing a token; rejects dup email and bad creds", async () => {
    const s = svc();
    const t1 = await s.signup("a@b.com", "pw");
    expect(t1.ok).toBe(true);
    expect((await s.signup("a@b.com", "pw")).ok).toBe(false); // duplicate
    const login = await s.login("a@b.com", "pw");
    expect(login.ok).toBe(true);
    expect((await s.login("a@b.com", "nope")).ok).toBe(false);
    expect((await s.login("missing@b.com", "pw")).ok).toBe(false);
  });
});
