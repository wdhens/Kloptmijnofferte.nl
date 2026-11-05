-- Time from upload started to report viewed, as bucket counts only (seconds, upper edge).
CREATE TABLE durations (
  day TEXT NOT NULL, bucket INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);
