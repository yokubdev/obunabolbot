-- Security hardening (Nov 2026).

-- Card numbers for payouts are stored encrypted (AES-256-GCM, key outside the DB).
-- card_number keeps only the last 4 digits from now on.
ALTER TABLE withdrawals ADD COLUMN card_enc TEXT;
UPDATE withdrawals SET card_number = right(card_number, 4) WHERE status <> 'pending';

-- SMS code attempts are limited, and a payment is claimed ('confirming') while the provider charges it,
-- so two parallel confirm requests can never charge twice.
ALTER TABLE payments ADD COLUMN otp_attempts INT NOT NULL DEFAULT 0;
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('created', 'pending_otp', 'confirming', 'paid', 'failed'));
CREATE INDEX payments_subscriber_created_idx ON payments (subscriber_id, created_at);

-- Auto-renewal is claimed per subscription, so overlapping job runs never charge a card twice.
ALTER TABLE subscriptions ADD COLUMN renew_attempted_at TIMESTAMPTZ;
