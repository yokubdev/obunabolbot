-- Content moderation: channel review state, rules consent, subscriber reports.
ALTER TABLE channels ADD COLUMN moderation TEXT NOT NULL DEFAULT 'active'
  CHECK (moderation IN ('pending', 'active', 'blocked'));
ALTER TABLE channels ADD COLUMN moderation_reason TEXT;
-- Flagged words a moderator already looked at and approved: they do not send the channel back to review.
ALTER TABLE channels ADD COLUMN reviewed_words TEXT[] NOT NULL DEFAULT '{}';
-- Sales start only after the owner accepts the platform rules (existing channels must accept too).
ALTER TABLE channels ADD COLUMN rules_accepted_at TIMESTAMPTZ;

CREATE TABLE reports (
  id             SERIAL PRIMARY KEY,
  channel_id     INT NOT NULL REFERENCES channels(id),
  subscriber_id  INT NOT NULL REFERENCES subscribers(id),
  reason         TEXT NOT NULL CHECK (reason IN ('adult', 'violence', 'fraud', 'drugs', 'copyright', 'other')),
  note           TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, subscriber_id)
);
CREATE INDEX reports_open_idx ON reports (channel_id) WHERE status = 'open';
