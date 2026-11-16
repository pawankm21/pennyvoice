CREATE TABLE ledger_entry (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
    id UUID PRIMARY KEY,
    kind VARCHAR(30) NOT NULL CHECK (kind IN ('expense', 'lent', 'borrowed', 'repayment-received', 'repayment-paid')),
    amount_paise BIGINT NOT NULL CHECK (amount_paise > 0 AND amount_paise <= 9007199254740991),
    entry_date DATE NOT NULL,
    description VARCHAR(500) NOT NULL CHECK (length(trim(description)) > 0),
    person VARCHAR(100) NOT NULL,
    CHECK (kind = 'expense' OR length(trim(person)) > 0)
);
CREATE INDEX ledger_entry_date_idx ON ledger_entry(entry_date);
