/**
 * What the platform needs from a card-acquiring provider. ATMOS implements it today;
 * another provider (Multicard, Payme, Click) can be added behind the same interface.
 */
export interface CardPaymentProvider {
  readonly name: string;
  /** Sends an SMS code to the card owner. Returns an opaque session id for `confirm`. */
  startCardPayment(args: { paymentId: number; amount: number; cardNumber: string; expiry: string }): Promise<{
    sessionId: string;
    phoneMask: string | null;
  }>;
  /** Checks the SMS code and charges the card. Returns the provider's transaction id and a reusable card token. */
  confirmCardPayment(args: { paymentId: number; amount: number; sessionId: string; otp: string }): Promise<{
    providerTxId: string;
    cardToken: string;
  }>;
  /** Charges a saved card without SMS (auto-renewal). */
  chargeToken(args: { paymentId: number; amount: number; cardToken: string }): Promise<{ providerTxId: string }>;
}

export class ProviderError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
