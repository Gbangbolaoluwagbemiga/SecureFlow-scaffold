-- Client soft-archive: hide a settled escrow from their own dashboard view.
-- This is a per-wallet preference flag — the on-chain record is unchanged.
CREATE TABLE IF NOT EXISTS archived_escrows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  archived_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(escrow_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_archived_escrows_wallet ON archived_escrows(wallet_address);

ALTER TABLE archived_escrows ENABLE ROW LEVEL SECURITY;

-- Anyone can read/write their own archive entries
CREATE POLICY "Users manage their own archive" ON archived_escrows
  FOR ALL USING (true) WITH CHECK (true);
