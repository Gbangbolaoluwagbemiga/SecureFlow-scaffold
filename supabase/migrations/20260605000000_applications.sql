-- Create applications table to store job application data
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  escrow_id INTEGER NOT NULL,
  freelancer_address TEXT NOT NULL,
  cover_letter TEXT DEFAULT '',
  proposed_timeline INTEGER DEFAULT 0,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(escrow_id, freelancer_address)
);

CREATE INDEX IF NOT EXISTS idx_applications_escrow_id ON applications(escrow_id);
CREATE INDEX IF NOT EXISTS idx_applications_freelancer ON applications(freelancer_address);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read applications"
  ON applications FOR SELECT
  USING (true);

CREATE POLICY "Anyone can insert applications"
  ON applications FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Anyone can update applications"
  ON applications FOR UPDATE
  USING (true);
