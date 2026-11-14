export interface PublicPlan { id: number; title: string; durationDays: number; price: number }
export interface PublicChannel { id: number; title: string; slug: string; description: string; subscribers: number }
export interface MySub {
  id: number; status: "active" | "expired"; expires_at: string; auto_renew: boolean;
  channel_id: number; channel_title: string; channel_slug: string; plan_title: string; plan_price: number;
}
export interface OwnerChannel { id: number; title: string; slug: string; description: string; is_active: boolean; link: string }
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
export interface Withdrawal { id: number; amount: number; card_number: string; status: "pending" | "paid" | "rejected"; note: string | null; created_at: string }
export interface WalletFull extends Wallet { ledger: LedgerRow[]; withdrawals: Withdrawal[] }
export interface Me { user: { id: number; first_name: string }; isOwner: boolean; isPlatformAdmin: boolean; botUsername: string }
