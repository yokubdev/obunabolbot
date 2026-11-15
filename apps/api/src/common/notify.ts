import type { Api } from "grammy";

/** Tells every platform admin; a failed send never fails the request that caused it. */
export async function notifyAdmins(tg: Api, adminIds: number[], text: string): Promise<void> {
  await Promise.allSettled(adminIds.map((id) => tg.sendMessage(id, text)));
}
