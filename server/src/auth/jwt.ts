import jwt from "jsonwebtoken";

export function signToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "30d" });
}

export function verifyToken(token: string, secret: string): string | null {
  try {
    const d = jwt.verify(token, secret);
    return typeof d === "object" && d && typeof d.sub === "string" ? d.sub : null;
  } catch {
    return null;
  }
}
