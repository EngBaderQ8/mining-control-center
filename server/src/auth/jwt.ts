import jwt from "jsonwebtoken";

export function signToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}

export function verifyToken(token: string, secret: string): string | null {
  try {
    // Pin the algorithm — never accept "none" or an attacker-chosen alg.
    const d = jwt.verify(token, secret, { algorithms: ["HS256"] });
    return typeof d === "object" && d && typeof d.sub === "string" ? d.sub : null;
  } catch {
    return null;
  }
}
