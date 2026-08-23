import { createHash, timingSafeEqual } from "node:crypto";

export function hashRoomPassword(password: string): string {
  return createHash("sha256").update(password, "utf8").digest("hex");
}

export function verifyRoomPassword(password: string, hash: string): boolean {
  const a = Buffer.from(hashRoomPassword(password), "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
