CREATE TABLE app_user (
    id UUID PRIMARY KEY,
    email VARCHAR(254) UNIQUE NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE refresh_session (
    token_hash VARCHAR(64) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES app_user(id),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX refresh_session_expiry_idx ON refresh_session(expires_at);
ALTER TABLE ledger_entry ADD COLUMN owner_id UUID REFERENCES app_user(id);
-- Legacy unowned records remain quarantined; never assign them to the first signup.
ALTER TABLE ledger_entry DROP CONSTRAINT ledger_entry_pkey;
ALTER TABLE ledger_entry ADD PRIMARY KEY (sequence);
CREATE UNIQUE INDEX ledger_entry_owner_entry_idx ON ledger_entry(owner_id, id);
CREATE INDEX ledger_entry_owner_date_idx ON ledger_entry(owner_id, entry_date);
