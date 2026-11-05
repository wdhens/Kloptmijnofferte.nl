-- Only anonymised, structured data. No originals, no names, no addresses.
CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,          -- for the 30-day withdrawal window
  created_month TEXT NOT NULL,       -- exports use month only
  product TEXT NOT NULL,
  pc4 TEXT,
  total_incl_vat REAL NOT NULL,
  record TEXT NOT NULL,              -- redacted ParsedQuote JSON, without installer_kvk
  installer_key TEXT,                -- HMAC of KvK number, never published
  uploader_key TEXT NOT NULL,        -- SHA-256 of the file, for duplicates and k-counting
  check_code_hash TEXT NOT NULL,
  consent_version TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL               -- ok | review
);
CREATE UNIQUE INDEX quotes_uploader ON quotes(uploader_key);
CREATE INDEX quotes_product ON quotes(product, status);

CREATE TABLE signups (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  confirm_token TEXT NOT NULL,
  confirmed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE spend (
  day TEXT PRIMARY KEY,
  usd REAL NOT NULL DEFAULT 0,
  checks INTEGER NOT NULL DEFAULT 0
);
