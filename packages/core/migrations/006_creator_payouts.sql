-- Creator payout profile: contact, tax status, payout terms and a manual identity check.
ALTER TABLE owners ADD COLUMN phone TEXT;
ALTER TABLE owners ADD COLUMN legal_status TEXT CHECK (legal_status IN ('self_employed', 'business', 'individual'));
ALTER TABLE owners ADD COLUMN business_tin TEXT;   -- STIR of a sole trader (YaTT) or company (MChJ)
ALTER TABLE owners ADD COLUMN business_name TEXT;
ALTER TABLE owners ADD COLUMN payout_terms_accepted_at TIMESTAMPTZ;
-- Identity check, done by a platform operator (no MyID): full name and PINFL, the PINFL encrypted at rest.
ALTER TABLE owners ADD COLUMN kyc_status TEXT NOT NULL DEFAULT 'none' CHECK (kyc_status IN ('none', 'pending', 'verified', 'rejected'));
ALTER TABLE owners ADD COLUMN kyc_full_name TEXT;
ALTER TABLE owners ADD COLUMN kyc_pinfl_enc TEXT;
ALTER TABLE owners ADD COLUMN kyc_note TEXT;
ALTER TABLE owners ADD COLUMN kyc_submitted_at TIMESTAMPTZ;
ALTER TABLE owners ADD COLUMN kyc_verified_at TIMESTAMPTZ;

ALTER TABLE subscribers ADD COLUMN language_code TEXT;
ALTER TABLE subscribers ADD COLUMN offer_accepted_at TIMESTAMPTZ;
ALTER TABLE subscribers ADD COLUMN bot_blocked BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE channels ADD COLUMN category TEXT CHECK (category IN
  ('education', 'business', 'finance', 'sport', 'health', 'tech', 'lifestyle', 'entertainment', 'news', 'other'));

-- The day the operator pays this request (requests are paid in one weekly batch).
ALTER TABLE withdrawals ADD COLUMN payout_date DATE;
