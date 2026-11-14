-- All money is stored in tiyin (1 so'm = 100 tiyin) as BIGINT.

CREATE TABLE owners (
  id          SERIAL PRIMARY KEY,
  tg_id       BIGINT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  username    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE channels (
  id           SERIAL PRIMARY KEY,
  owner_id     INT NOT NULL REFERENCES owners(id),
  tg_chat_id   BIGINT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  description  TEXT NOT NULL DEFAULT '',
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE plans (
  id             SERIAL PRIMARY KEY,
  channel_id     INT NOT NULL REFERENCES channels(id),
  title          TEXT NOT NULL,
  duration_days  INT NOT NULL CHECK (duration_days > 0),
  price          BIGINT NOT NULL CHECK (price > 0),
  is_active      BOOLEAN NOT NULL DEFAULT true,
  sort           INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscribers (
  id          SERIAL PRIMARY KEY,
  tg_id       BIGINT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  username    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE subscriptions (
  id             SERIAL PRIMARY KEY,
  subscriber_id  INT NOT NULL REFERENCES subscribers(id),
  channel_id     INT NOT NULL REFERENCES channels(id),
  plan_id        INT NOT NULL REFERENCES plans(id),
  status         TEXT NOT NULL CHECK (status IN ('active', 'expired')),
  starts_at      TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  auto_renew     BOOLEAN NOT NULL DEFAULT false,
  card_token     TEXT,
  reminded_3d    BOOLEAN NOT NULL DEFAULT false,
  reminded_1d    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (subscriber_id, channel_id)
);
CREATE INDEX subscriptions_expires_idx ON subscriptions (status, expires_at);

CREATE TABLE payments (
  id               SERIAL PRIMARY KEY,
  subscriber_id    INT NOT NULL REFERENCES subscribers(id),
  channel_id       INT NOT NULL REFERENCES channels(id),
  plan_id          INT NOT NULL REFERENCES plans(id),
  amount           BIGINT NOT NULL CHECK (amount > 0),
  provider         TEXT NOT NULL,
  provider_tx_id   TEXT UNIQUE,
  status           TEXT NOT NULL CHECK (status IN ('created', 'pending_otp', 'paid', 'failed')),
  auto_renew       BOOLEAN NOT NULL DEFAULT false,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at          TIMESTAMPTZ
);

CREATE TABLE withdrawals (
  id            SERIAL PRIMARY KEY,
  owner_id      INT NOT NULL REFERENCES owners(id),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  card_number   TEXT NOT NULL, -- TODO: encrypt at rest before production
  status        TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'rejected')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ
);

-- The virtual cashbox. Balance is always SUM(amount); it is never stored.
CREATE TABLE ledger_entries (
  id             BIGSERIAL PRIMARY KEY,
  owner_id       INT NOT NULL REFERENCES owners(id),
  amount         BIGINT NOT NULL CHECK (amount <> 0),
  type           TEXT NOT NULL CHECK (type IN ('payment', 'commission', 'withdrawal', 'withdrawal_reversal')),
  payment_id     INT REFERENCES payments(id),
  withdrawal_id  INT REFERENCES withdrawals(id),
  available_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_owner_idx ON ledger_entries (owner_id, available_at);
CREATE UNIQUE INDEX ledger_payment_type_uq ON ledger_entries (payment_id, type) WHERE payment_id IS NOT NULL;
