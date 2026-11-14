import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Payout card numbers are encrypted at rest with AES-256-GCM. The key (32 bytes, base64 in
 * CARD_ENC_KEY) lives in the environment, never in the database, so a DB dump alone leaks no cards.
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>".
 */
export function parseCardKey(b64: string): Buffer {
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("CARD_ENC_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptCard(digits: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(digits, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function decryptCard(blob: string, key: Buffer): string {
  const [v, iv, tag, data] = blob.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("unknown card blob format");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
