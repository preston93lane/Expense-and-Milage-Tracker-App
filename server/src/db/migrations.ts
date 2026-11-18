/**
 * Database schema, as an ordered list of migrations. Never edit a migration
 * that has shipped — add a new one. The database's PRAGMA user_version holds
 * the number of the last applied migration. A backup is taken automatically
 * before any migration runs on a database that already has data.
 */
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'initial schema: accounts, categories, transactions, rules, imports',
    sql: `
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        institution TEXT,
        type TEXT NOT NULL DEFAULT 'checking'
          CHECK (type IN ('checking','savings','credit_card','cash','other')),
        last4 TEXT,
        csv_mapping TEXT,
        ofx_account_id TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        key TEXT UNIQUE,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        kind TEXT NOT NULL CHECK (kind IN ('expense','income','other')),
        tax_line TEXT NOT NULL,
        deductible_pct INTEGER NOT NULL DEFAULT 100,
        description TEXT,
        aliases TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_system INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE rules (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_confirm INTEGER NOT NULL DEFAULT 1,
        conditions TEXT NOT NULL,
        actions TEXT NOT NULL,
        match_count INTEGER NOT NULL DEFAULT 0,
        last_matched_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE import_batches (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        file_name TEXT,
        file_sha256 TEXT,
        stored_file TEXT,
        history_mode INTEGER NOT NULL DEFAULT 0,
        row_count INTEGER NOT NULL DEFAULT 0,
        new_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        date_from TEXT,
        date_to TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        batch_id INTEGER REFERENCES import_batches(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        description TEXT NOT NULL,
        memo TEXT,
        merchant TEXT NOT NULL,
        merchant_key TEXT NOT NULL,
        city TEXT,
        state TEXT,
        is_online INTEGER NOT NULL DEFAULT 0,
        external_id TEXT,
        check_number TEXT,
        dedupe_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unreviewed'
          CHECK (status IN ('unreviewed','suggested','reviewed')),
        classification TEXT CHECK (classification IN ('business','personal','transfer')),
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        is_split INTEGER NOT NULL DEFAULT 0,
        source TEXT,
        confidence REAL,
        rule_id INTEGER REFERENCES rules(id) ON DELETE SET NULL,
        transfer_pair_id INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX ux_transactions_dedupe ON transactions(account_id, dedupe_key);
      CREATE INDEX ix_transactions_date ON transactions(date);
      CREATE INDEX ix_transactions_status ON transactions(status);
      CREATE INDEX ix_transactions_merchant ON transactions(merchant_key);
      CREATE INDEX ix_transactions_batch ON transactions(batch_id);

      CREATE TABLE splits (
        id INTEGER PRIMARY KEY,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        amount_cents INTEGER NOT NULL,
        classification TEXT NOT NULL CHECK (classification IN ('business','personal','transfer')),
        category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
        note TEXT
      );
      CREATE INDEX ix_splits_tx ON splits(transaction_id);

      CREATE TABLE action_log (
        id INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        summary TEXT NOT NULL,
        undo_json TEXT NOT NULL,
        undone_at TEXT
      );

      CREATE TABLE mileage_rates (
        id INTEGER PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'business',
        effective_from TEXT NOT NULL,
        effective_to TEXT NOT NULL,
        cents_per_mile REAL NOT NULL,
        note TEXT
      );

      -- Every money line that reports add up: whole transactions, or their
      -- split lines when a transaction is split.
      CREATE VIEW ledger_lines AS
        SELECT t.id AS transaction_id, NULL AS split_id, t.account_id, t.date,
               t.amount_cents, t.classification, t.category_id, t.status, t.merchant
          FROM transactions t WHERE t.is_split = 0
        UNION ALL
        SELECT t.id, s.id, t.account_id, t.date,
               s.amount_cents, s.classification, s.category_id, t.status, t.merchant
          FROM splits s JOIN transactions t ON t.id = s.transaction_id
         WHERE t.is_split = 1;
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
