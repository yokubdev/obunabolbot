export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface Owner { id: number; tg_id: number; name: string; username: string | null; created_at: Date }
export interface Subscriber { id: number; tg_id: number; name: string; username: string | null; created_at: Date }
export interface Channel {
  id: number; owner_id: number; tg_chat_id: number; title: string; slug: string;
  description: string; is_active: boolean; created_at: Date;
  perks: string[]; welcome_text: string; trial_days: number; chat_type: "channel" | "supergroup";
  moderation: "pending" | "active" | "blocked"; moderation_reason: string | null; rules_accepted_at: Date | null;
  reviewed_words: string[];
}
export interface Plan {
  id: number; channel_id: number; title: string; duration_days: number; price: number;
  is_active: boolean; sort: number;
}
export interface Subscription {
  id: number; subscriber_id: number; channel_id: number; plan_id: number;
  status: "active" | "expired"; starts_at: Date; expires_at: Date; auto_renew: boolean;
  card_token: string | null; reminded_3d: boolean; reminded_1d: boolean; is_trial: boolean;
}
export interface Payment {
  id: number; subscriber_id: number; channel_id: number; plan_id: number; amount: number;
  list_price: number | null; promo_code_id: number | null;
  provider: string; provider_tx_id: string | null;
  status: "created" | "pending_otp" | "confirming" | "paid" | "failed"; auto_renew: boolean; otp_attempts: number;
  error: string | null; created_at: Date; paid_at: Date | null;
}
export interface Withdrawal {
  id: number; owner_id: number; amount: number; /** Last 4 digits only. */ card_number: string; card_enc: string | null;
  status: "pending" | "paid" | "rejected"; note: string | null; created_at: Date; processed_at: Date | null;
}

export const displayName = (u: TgUser) => [u.first_name, u.last_name].filter(Boolean).join(" ");
