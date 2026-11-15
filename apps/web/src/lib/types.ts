export interface PublicPlan { id: number; title: string; durationDays: number; price: number }
export interface PublicChannel {
  id: number; title: string; slug: string; description: string; subscribers: number;
  perks: string[]; trialDays: number; chatType: "channel" | "supergroup"; photoUrl: string; canSell: boolean;
}
export interface MySub {
  id: number; status: "active" | "expired"; expires_at: string; auto_renew: boolean;
  channel_id: number; channel_title: string; channel_slug: string; plan_title: string; plan_price: number;
}
export interface OwnerChannel {
  id: number; title: string; slug: string; description: string; is_active: boolean; link: string;
  perks: string[]; welcome_text: string; trial_days: number; chat_type: "channel" | "supergroup";
  moderation: "pending" | "active" | "blocked"; moderation_reason: string | null; rules_accepted_at: string | null;
  category: string | null;
}
export interface Wallet { available: number; pending: number; commissionThisMonth: number }
export interface Stats {
  revenueThisMonth: number; revenuePrevMonth: number; activeSubscribers: number; newThisMonth: number;
  expiringSoon: number; churnedThisMonth: number; monthly: { month: string; revenue: number }[];
}
export interface Overview { owner: { name: string }; channels: OwnerChannel[]; stats: Stats; wallet: Wallet; commissionBps: number }
export interface OwnerSub {
  id: number; status: "active" | "expired"; expires_at: string; auto_renew: boolean; subscriber_name: string;
  subscriber_username: string | null; channel_title: string; plan_title: string; total_paid: number;
}
export interface Plan { id: number; title: string; duration_days: number; price: number; is_active: boolean }
export interface LedgerRow {
  id: number; amount: number; type: "payment" | "commission" | "withdrawal" | "withdrawal_reversal";
  created_at: string; available_at: string; subscriber_name: string | null; plan_title: string | null; card_number: string | null;
}
export interface Withdrawal { id: number; amount: number; card_number: string; status: "pending" | "paid" | "rejected"; note: string | null; created_at: string; payout_date: string | null }

export type LegalStatus = "self_employed" | "business" | "individual";
export type KycStatus = "none" | "pending" | "verified" | "rejected";
export interface PayoutProfile {
  phone: string | null; legalStatus: LegalStatus | null; businessTin: string | null; businessName: string | null;
  termsAccepted: boolean; complete: boolean;
  kyc: { status: KycStatus; fullName: string | null; pinfl: string | null; note: string | null };
  withdrawnThisMonth: number; kycMonthlyLimit: number; nextPayoutDate: string;
}
export interface WalletFull extends Wallet { ledger: LedgerRow[]; withdrawals: Withdrawal[] }
export interface Me { user: { id: number; first_name: string }; isOwner: boolean; isPlatformAdmin: boolean; botUsername: string }

export interface Promo {
  id: number; channel_id: number; code: string; kind: "percent" | "amount"; value: number; plan_id: number | null;
  max_uses: number | null; used_count: number; expires_at: string | null; is_active: boolean; created_at: string;
}

export interface ModerationRow {
  id: number; title: string; slug: string; moderation: "pending" | "active" | "blocked"; moderation_reason: string | null;
  owner_name: string; owner_tg_id: number; created_at: string; open_reports: number;
  reports: { reason: string; note: string; created_at: string }[];
}
