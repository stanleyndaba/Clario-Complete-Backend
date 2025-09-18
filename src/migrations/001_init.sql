CREATE TABLE claims (
  claim_id TEXT PRIMARY KEY,
  status TEXT NOT NULL, -- detected, validated, ready_to_file, submitted, rejected, approved, failed
  claim_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  amount_estimate REAL NOT NULL,
  quantity_affected INTEGER NOT NULL,
  metadata JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE validations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id TEXT NOT NULL REFERENCES claims(claim_id),
  compliant INTEGER NOT NULL,
  ml_validity_score REAL NOT NULL,
  missing_evidence JSON NOT NULL,
  reasons JSON NOT NULL,
  auto_file_ready INTEGER NOT NULL,
  confidence_calibrated REAL NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_claims_id ON claims(claim_id);

CREATE TABLE filings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id TEXT NOT NULL REFERENCES claims(claim_id),
  amazon_case_id TEXT,
  status TEXT NOT NULL,
  message TEXT,
  packet JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE idempotency_keys (
  key TEXT PRIMARY KEY,
  claim_id TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

