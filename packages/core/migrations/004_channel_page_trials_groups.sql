-- Channel page settings, free trials and groups.
ALTER TABLE channels ADD COLUMN perks TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE channels ADD COLUMN welcome_text TEXT NOT NULL DEFAULT '';
-- 0 = no trial; otherwise days of free access a new subscriber gets once per channel.
ALTER TABLE channels ADD COLUMN trial_days INT NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 30);
ALTER TABLE channels ADD COLUMN chat_type TEXT NOT NULL DEFAULT 'channel' CHECK (chat_type IN ('channel', 'supergroup'));

ALTER TABLE subscriptions ADD COLUMN is_trial BOOLEAN NOT NULL DEFAULT false;
