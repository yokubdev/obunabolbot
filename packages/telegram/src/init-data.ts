import { createHmac, timingSafeEqual } from "node:crypto";
import type { TgUser } from "@obuna/core";

/**
 * Validates Telegram Mini App initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
 * Returns the user when the signature is valid and not older than `maxAgeSec`, otherwise null.
 */
export function validateInitData(initData: string, botToken: string, maxAgeSec = 24 * 3600): TgUser | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secret).update(checkString).digest("hex");
  if (expected.length !== hash.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "null") as TgUser | null;
    return user && typeof user.id === "number" ? user : null;
  } catch {
    return null;
  }
}

/** Test helper: builds a correctly signed initData string. */
export function signInitData(user: TgUser, botToken: string, authDate = Math.floor(Date.now() / 1000)): string {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user) });
  const checkString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  params.set("hash", createHmac("sha256", secret).update(checkString).digest("hex"));
  return params.toString();
}
