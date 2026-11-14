import { describe, expect, it } from "vitest";
import { AtmosProvider, MockProvider } from "../src/index.js";

function fakeFetch(routes: Record<string, unknown>) {
  const calls: { path: string; body: any }[] = [];
  const f = async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, body: init?.body && path !== "/token" ? JSON.parse(String(init.body)) : null });
    const body = routes[path];
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  };
  return { f: f as typeof fetch, calls };
}

describe("AtmosProvider", () => {
  const ok = { code: "OK", description: "Нет ошибок" };

  it("binds the card, then pays with the token", async () => {
    const { f, calls } = fakeFetch({
      "/token": { access_token: "T", expires_in: 3600 },
      "/partner/bind-card/init": { result: ok, transaction_id: 77, phone: "99890***17" },
      "/partner/bind-card/confirm": { result: ok, data: { card_token: "CT" } },
      "/merchant/pay/create": { result: ok, transaction_id: 500 },
      "/merchant/pay/pre-apply": { result: ok, transaction_id: 500 },
      "/merchant/pay/apply": { result: ok, store_transaction: { success_trans_id: 9001 } },
    });
    const p = new AtmosProvider({ baseUrl: "https://apigw.atmos.uz", consumerKey: "k", consumerSecret: "s", storeId: "42", fetch: f });
    const start = await p.startCardPayment({ paymentId: 1, amount: 4_900_000, cardNumber: "8600123412341234", expiry: "2809" });
    expect(start.sessionId).toBe("77");
    const res = await p.confirmCardPayment({ paymentId: 1, amount: 4_900_000, sessionId: "77", otp: "123456" });
    expect(res).toEqual({ providerTxId: "atmos:9001", cardToken: "CT" });
    expect(calls.map((c) => c.path)).toEqual([
      "/token", "/partner/bind-card/init", "/partner/bind-card/confirm",
      "/merchant/pay/create", "/merchant/pay/pre-apply", "/merchant/pay/apply",
    ]);
    expect(calls[3]!.body).toMatchObject({ amount: 4_900_000, account: "1", store_id: 42 });
    expect(calls[5]!.body).toMatchObject({ otp: "111111", transaction_id: 500 });
  });

  it("surfaces ATMOS error codes", async () => {
    const { f } = fakeFetch({
      "/token": { access_token: "T", expires_in: 3600 },
      "/partner/bind-card/init": { result: { code: "STPIMS-ERR-092", description: "Karta bloklangan" } },
    });
    const p = new AtmosProvider({ baseUrl: "https://x.uz", consumerKey: "k", consumerSecret: "s", storeId: "1", fetch: f });
    await expect(p.startCardPayment({ paymentId: 1, amount: 1, cardNumber: "8600", expiry: "2809" })).rejects.toThrow("Karta bloklangan");
  });
});

describe("MockProvider", () => {
  it("accepts 111111 only", async () => {
    const p = new MockProvider();
    const s = await p.startCardPayment({ cardNumber: "8600123412344417" } as any);
    await expect(p.confirmCardPayment({ paymentId: 1, sessionId: s.sessionId, otp: "000000" } as any)).rejects.toThrow();
    const r = await p.confirmCardPayment({ paymentId: 1, sessionId: s.sessionId, otp: "111111" } as any);
    expect(r.cardToken).toBe("mock-token-4417");
  });
});
