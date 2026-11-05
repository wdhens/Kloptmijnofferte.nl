-- Cookieless analytics: daily counters only. No IP, no user agent, no visitor id.
CREATE TABLE events (
  day TEXT NOT NULL, path TEXT NOT NULL, step TEXT NOT NULL, exp TEXT NOT NULL DEFAULT '', variant TEXT NOT NULL DEFAULT '',
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path, step, exp, variant)
);
CREATE TABLE variants (
  exp TEXT NOT NULL, id TEXT NOT NULL, copy TEXT NOT NULL, source TEXT NOT NULL,
  status TEXT NOT NULL,              -- champion | live | retired
  created_at TEXT NOT NULL, decided_at TEXT, reason TEXT,
  PRIMARY KEY (exp, id)
);
CREATE TABLE reports (
  created_at TEXT PRIMARY KEY,
  body TEXT NOT NULL
);
