// The demo database: a small slice of what a demand-planning team actually
// looks at. Factories hold inventory of parts, parts have suppliers with lead
// times, and we track weekly demand forecast vs. what actually got consumed.
//
// It's seeded in memory on cold start (see db.ts), so the whole thing is
// read-only and disposable — no database to provision.

export const SEED_SQL = `
CREATE TABLE factories (
  id       INTEGER PRIMARY KEY,
  name     TEXT NOT NULL,
  location TEXT NOT NULL
);

CREATE TABLE parts (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL,
  reorder_point INTEGER NOT NULL,  -- reorder when total on_hand drops below this
  unit_cost     REAL NOT NULL
);

CREATE TABLE inventory (
  factory_id INTEGER NOT NULL REFERENCES factories(id),
  part_id    INTEGER NOT NULL REFERENCES parts(id),
  on_hand    INTEGER NOT NULL
);

CREATE TABLE suppliers (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  country             TEXT NOT NULL,
  avg_lead_time_days  INTEGER NOT NULL
);

CREATE TABLE part_suppliers (
  part_id     INTEGER NOT NULL REFERENCES parts(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  unit_price  REAL NOT NULL
);

CREATE TABLE weekly_demand (
  part_id       INTEGER NOT NULL REFERENCES parts(id),
  week_start    TEXT NOT NULL,     -- ISO date, Monday of the week
  forecast_units INTEGER NOT NULL,
  actual_units   INTEGER           -- NULL for weeks not yet closed
);

INSERT INTO factories (id, name, location) VALUES
  (1, 'Fremont',  'Fremont, CA'),
  (2, 'Austin',   'Austin, TX'),
  (3, 'Reno',     'Reno, NV');

INSERT INTO parts (id, name, category, reorder_point, unit_cost) VALUES
  (1, 'Battery cell 4680',   'cell',       12000, 3.10),
  (2, 'BMS control board',   'electronics',  800, 47.00),
  (3, 'Wiring harness',      'electrical',  1500, 22.50),
  (4, 'Front drive unit',    'drivetrain',   300, 940.00),
  (5, 'Brake caliper',       'chassis',     2000, 65.00),
  (6, 'HVAC compressor',     'thermal',      900, 130.00),
  (7, 'Coolant pump',        'thermal',     1800, 41.00),
  (8, 'Charge port',         'electrical',   600, 88.00);

INSERT INTO inventory (factory_id, part_id, on_hand) VALUES
  (1, 1, 9800),  (1, 2, 1200), (1, 3, 900),  (1, 4, 260),
  (1, 5, 3100),  (1, 6, 400),  (1, 7, 2200), (1, 8, 350),
  (2, 1, 15400), (2, 2, 640),  (2, 3, 1750), (2, 4, 410),
  (2, 5, 1800),  (2, 6, 720),  (2, 7, 1300), (2, 8, 210),
  (3, 1, 4200),  (3, 3, 300),  (3, 5, 950),  (3, 7, 640);

INSERT INTO suppliers (id, name, country, avg_lead_time_days) VALUES
  (1, 'Panasonic Energy', 'Japan',         45),
  (2, 'Nidec',            'Japan',         38),
  (3, 'Aptiv',            'United States', 21),
  (4, 'Sensata',          'United States', 16),
  (5, 'Hanon Systems',    'South Korea',   52);

INSERT INTO part_suppliers (part_id, supplier_id, unit_price) VALUES
  (1, 1, 3.10), (2, 3, 47.00), (2, 4, 49.50), (3, 3, 22.50),
  (4, 2, 940.00), (5, 4, 65.00), (6, 5, 130.00), (7, 5, 41.00),
  (7, 3, 43.00), (8, 3, 88.00);

INSERT INTO weekly_demand (part_id, week_start, forecast_units, actual_units) VALUES
  (1, '2026-06-15', 21000, 22400),
  (1, '2026-06-22', 21500, 19800),
  (2, '2026-06-15', 1100, 1180),
  (2, '2026-06-22', 1150, 990),
  (3, '2026-06-15', 1600, 1720),
  (3, '2026-06-22', 1650, NULL),
  (4, '2026-06-15', 420, 405),
  (4, '2026-06-22', 430, 460),
  (5, '2026-06-15', 2500, 2380),
  (6, '2026-06-15', 850, 910),
  (7, '2026-06-15', 1900, 1840),
  (8, '2026-06-15', 560, 620);
`;

// Handed to the model verbatim. Keep it tight — it's the grounding context, so
// column names and the couple of business rules matter more than prose.
export const SCHEMA_DOC = `
factories(id, name, location)
parts(id, name, category, reorder_point, unit_cost)
inventory(factory_id, part_id, on_hand)          -- one row per part per factory
suppliers(id, name, country, avg_lead_time_days)
part_suppliers(part_id, supplier_id, unit_price) -- a part can have several suppliers
weekly_demand(part_id, week_start, forecast_units, actual_units)

Notes:
- "on hand" for a part means SUM(on_hand) across all factories unless a specific factory is named.
- A part is "below its reorder point" when its total on_hand across factories is less than parts.reorder_point.
- Inventory value = on_hand * parts.unit_cost.
- week_start is the Monday of the week, stored as an ISO date string. actual_units is NULL for weeks that haven't closed yet.
- Forecast error for a closed week = actual_units - forecast_units.
`.trim();

export const SAMPLE_QUESTIONS = [
  'Which parts are below their reorder point?',
  'Total inventory value by factory, highest first',
  'Which suppliers have an average lead time over 30 days?',
  'For each closed week, how far off was the forecast from actual demand?',
  'Which part has the most on-hand units across all factories?',
];
