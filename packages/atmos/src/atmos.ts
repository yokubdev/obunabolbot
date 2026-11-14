import { ProviderError, type CardPaymentProvider } from "./provider.js";

export interface AtmosConfig {
  baseUrl: string; // https://apigw.atmos.uz
  consumerKey: string;
  consumerSecret: string;
  storeId: string;
  fetch?: typeof fetch;
}

interface AtmosResult {
  result?: { code: string; description?: string };
  [k: string]: unknown;
}

/**
 * ATMOS merchant API client (https://docs.atmos.uz).
 * Flow per payment: bind the card (SMS code) → create transaction → pre-apply with card_token → apply.
 * Binding first gives one SMS for the subscriber and a card_token we can reuse for auto-renewal.
 */
export class AtmosProvider implements CardPaymentProvider {
  readonly name = "atmos";
  private token: { value: string; expiresAt: number } | null = null;
  private readonly http: typeof fetch;

  constructor(private readonly cfg: AtmosConfig) {
    this.http = cfg.fetch ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const basic = Buffer.from(`${this.cfg.consumerKey}:${this.cfg.consumerSecret}`).toString("base64");
    const res = await this.http(`${this.cfg.baseUrl}/token?grant_type=client_credentials`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new ProviderError("auth", `ATMOS token so'rovi muvaffaqiyatsiz: ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async call<T extends AtmosResult>(path: string, payload: Record<string, unknown>): Promise<T> {
    const res = await this.http(`${this.cfg.baseUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.status === 401) this.token = null;
    const body = (await res.json().catch(() => ({}))) as T;
    const code = body.result?.code;
    if (!res.ok || code !== "OK") {
      throw new ProviderError(code ?? `http_${res.status}`, body.result?.description ?? "ATMOS xatosi");
    }
    return body;
  }

  async startCardPayment(args: { paymentId: number; amount: number; cardNumber: string; expiry: string }) {
    const body = await this.call<AtmosResult & { transaction_id: number; phone?: string }>("/partner/bind-card/init", {
      card_number: args.cardNumber,
      expiry: args.expiry, // YYmm
    });
    return { sessionId: String(body.transaction_id), phoneMask: body.phone ?? null };
  }

  async confirmCardPayment(args: { paymentId: number; amount: number; sessionId: string; otp: string }) {
    const bound = await this.call<AtmosResult & { data: { card_token: string } }>("/partner/bind-card/confirm", {
      transaction_id: Number(args.sessionId),
      otp: args.otp,
    });
    const cardToken = bound.data.card_token;
    const { providerTxId } = await this.chargeToken({ paymentId: args.paymentId, amount: args.amount, cardToken });
    return { providerTxId, cardToken };
  }

  async chargeToken(args: { paymentId: number; amount: number; cardToken: string }) {
    const storeId = Number(this.cfg.storeId);
    const created = await this.call<AtmosResult & { transaction_id: number }>("/merchant/pay/create", {
      amount: args.amount,
      account: String(args.paymentId),
      store_id: storeId,
      lang: "uz",
    });
    await this.call("/merchant/pay/pre-apply", {
      store_id: storeId,
      transaction_id: created.transaction_id,
      card_token: args.cardToken,
    });
    const applied = await this.call<AtmosResult & { store_transaction?: { success_trans_id?: number; trans_id?: number } }>(
      "/merchant/pay/apply",
      { store_id: storeId, transaction_id: created.transaction_id, otp: "111111" },
    );
    const tx = applied.store_transaction?.success_trans_id ?? applied.store_transaction?.trans_id ?? created.transaction_id;
    return { providerTxId: `atmos:${tx}` };
  }
}

/** In-memory provider for local development and tests. The SMS code is always 111111. */
export class MockProvider implements CardPaymentProvider {
  readonly name = "mock";
  private seq = 0;
  private sessions = new Map<string, string>();

  async startCardPayment(args: { cardNumber: string }) {
    if (args.cardNumber.replace(/\D/g, "").length !== 16) throw new ProviderError("bad_card", "Karta raqami noto'g'ri");
    const id = `s${++this.seq}`;
    this.sessions.set(id, args.cardNumber.slice(-4));
    return { sessionId: id, phoneMask: "+998 ** *** ** 17" };
  }

  async confirmCardPayment(args: { paymentId: number; sessionId: string; otp: string }) {
    const last4 = this.sessions.get(args.sessionId);
    if (!last4) throw new ProviderError("no_session", "Sessiya topilmadi");
    if (args.otp !== "111111") throw new ProviderError("bad_otp", "SMS-kod noto'g'ri");
    this.sessions.delete(args.sessionId);
    return { providerTxId: `mock:${args.paymentId}`, cardToken: `mock-token-${last4}` };
  }

  async chargeToken(args: { paymentId: number }) {
    return { providerTxId: `mock:${args.paymentId}` };
  }
}
