-- Support: chat, contact form, email. No conversation text is stored.
-- Daily counters per intent and outcome (no text, no id).
CREATE TABLE support_stats (
  day TEXT NOT NULL, channel TEXT NOT NULL, intent TEXT NOT NULL, outcome TEXT NOT NULL, kb_id TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, channel, intent, outcome, kb_id)
);
-- Short PII-checked topic phrases of questions the bot could not answer well. Deleted after 180 days.
CREATE TABLE support_topics (
  day TEXT NOT NULL, topic TEXT NOT NULL, intent TEXT NOT NULL, outcome TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, topic, intent, outcome)
);
-- Cases for a human (complaints, privacy, installers, business). Contact details are needed to answer;
-- email and message are cleared 30 days after creation, the row (kind, dates) stays as a record.
CREATE TABLE tickets (
  ref TEXT PRIMARY KEY,               -- KMO-XXXXXX, also in the mail subject
  created_at TEXT NOT NULL,
  channel TEXT NOT NULL,              -- chat | form | email
  kind TEXT NOT NULL,                 -- klacht | privacy | installateur | zakelijk | onduidelijk | antwoord_op_bot
  email TEXT,
  message TEXT,
  due_at TEXT NOT NULL,               -- 5 working days, privacy 1 month
  auto_answered INTEGER NOT NULL DEFAULT 0,
  purged_at TEXT
);
CREATE INDEX tickets_created ON tickets(created_at);
-- FAQ entries written by the weekly learning loop, built only from existing knowledge-base facts.
CREATE TABLE kb_learned (
  id TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, keywords TEXT NOT NULL,
  based_on TEXT NOT NULL, status TEXT NOT NULL,   -- live | retired | draft
  created_at TEXT NOT NULL, reason TEXT
);
-- Auto-reply flood protection: SHA-256 of sender address per day. Deleted after 2 days.
CREATE TABLE mail_rate (
  day TEXT NOT NULL, sender_hash TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, sender_hash)
);
-- Chat spend is tracked separately from quote parsing, with its own daily cap.
CREATE TABLE support_spend (
  day TEXT PRIMARY KEY, usd REAL NOT NULL DEFAULT 0, answers INTEGER NOT NULL DEFAULT 0
);
