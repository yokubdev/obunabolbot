-- Promo codes: a channel owner's discount codes, applied to the first payment of a subscription.
CREATE TABLE promo_codes (
  id           SERIAL PRIMARY KEY,
  channel_id   INT NOT NULL REFERENCES channels(id),
  code         TEXT NOT NULL CHECK (code ~ '^[A-Z0-9_]{3,20}$'),
  kind         TEXT NOT NULL CHECK (kind IN ('percent', 'amount')),
  -- percent: 1..90; amount: tiyin off the plan price.
  value        BIGINT NOT NULL CHECK (value > 0),
  plan_id      INT REFERENCES plans(id),          -- NULL = every plan of the channel
  max_uses     INT CHECK (max_uses > 0),          -- NULL = unlimited
  used_count   INT NOT NULL DEFAULT 0,
  expires_at   TIMESTAMPTZ,                       -- NULL = never
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, code)
);

-- What the subscriber was offered: list price, the discount and the code used.
ALTER TABLE payments ADD COLUMN list_price BIGINT;
ALTER TABLE payments ADD COLUMN promo_code_id INT REFERENCES promo_codes(id);
CREATE INDEX payments_promo_idx ON payments (promo_code_id, subscriber_id) WHERE promo_code_id IS NOT NULL;
