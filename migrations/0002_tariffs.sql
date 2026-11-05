CREATE TABLE tariffs (
  period TEXT PRIMARY KEY,
  gas_per_m3 REAL NOT NULL,
  electricity_per_kwh REAL NOT NULL,
  fetched_at TEXT NOT NULL
);
