ALTER TABLE refresh_session ADD COLUMN family_id UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE refresh_session ADD COLUMN rotated_at TIMESTAMPTZ;
CREATE INDEX refresh_session_family_idx ON refresh_session(family_id);
