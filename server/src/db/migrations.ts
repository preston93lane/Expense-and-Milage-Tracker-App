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
  {
    version: 2,
    name: 'business trips',
    sql: `
      CREATE TABLE business_trips (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        dest_city TEXT,
        dest_state TEXT,
        purpose TEXT,
        before_days INTEGER NOT NULL DEFAULT 60,
        after_days INTEGER NOT NULL DEFAULT 5,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      ALTER TABLE transactions ADD COLUMN trip_id INTEGER REFERENCES business_trips(id) ON DELETE SET NULL;
      CREATE INDEX ix_transactions_trip ON transactions(trip_id);

      DROP VIEW ledger_lines;
      CREATE VIEW ledger_lines AS
        SELECT t.id AS transaction_id, NULL AS split_id, t.account_id, t.date,
               t.amount_cents, t.classification, t.category_id, t.status, t.merchant, t.trip_id
          FROM transactions t WHERE t.is_split = 0
        UNION ALL
        SELECT t.id, s.id, t.account_id, t.date,
               s.amount_cents, s.classification, s.category_id, t.status, t.merchant, t.trip_id
          FROM splits s JOIN transactions t ON t.id = s.transaction_id
         WHERE t.is_split = 1;
    `,
  },
  {
    version: 3,
    name: 'rule exceptions: ignore a rule for one transaction',
    sql: `
      CREATE TABLE rule_exceptions (
        rule_id INTEGER NOT NULL REFERENCES rules(id) ON DELETE CASCADE,
        transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
        PRIMARY KEY (rule_id, transaction_id)
      );
    `,
  },
  {
    version: 4,
    name: 'income: clients, projects, invoices, retainers, contractors',
    sql: `
      CREATE TABLE clients (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        email TEXT,
        phone TEXT,
        address TEXT,
        notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE projects (
        id INTEGER PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','archived')),
        budget_cents INTEGER,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE contractors (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        business_name TEXT,
        email TEXT,
        address TEXT,
        tin_last4 TEXT,
        entity_type TEXT NOT NULL DEFAULT 'individual'
          CHECK (entity_type IN ('individual','sole_prop','llc','partnership','s_corp','c_corp','other')),
        w9_received INTEGER NOT NULL DEFAULT 0,
        w9_date TEXT,
        notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      ALTER TABLE transactions ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN contractor_id INTEGER REFERENCES contractors(id) ON DELETE SET NULL;
      ALTER TABLE transactions ADD COLUMN payment_method TEXT CHECK (payment_method IN ('direct','card_or_processor'));
      CREATE INDEX ix_transactions_client ON transactions(client_id);
      CREATE INDEX ix_transactions_contractor ON transactions(contractor_id);

      ALTER TABLE business_trips ADD COLUMN client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
      ALTER TABLE business_trips ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
      ALTER TABLE business_trips ADD COLUMN agreed_fee_cents INTEGER;

      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
        trip_id INTEGER REFERENCES business_trips(id) ON DELETE SET NULL,
        number TEXT,
        issue_date TEXT NOT NULL,
        due_date TEXT,
        status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','sent','void')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE invoice_lines (
        id INTEGER PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        description TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 1,
        unit_cents INTEGER NOT NULL,
        sort INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE invoice_payments (
        id INTEGER PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
        amount_cents INTEGER NOT NULL,
        date TEXT NOT NULL,
        note TEXT
      );
      CREATE INDEX ix_invoice_payments_tx ON invoice_payments(transaction_id);

      CREATE TABLE retainers (
        id INTEGER PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        frequency TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','quarterly','yearly')),
        start_date TEXT NOT NULL,
        end_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE income_goals (
        year INTEGER PRIMARY KEY,
        amount_cents INTEGER NOT NULL
      );

      DROP VIEW ledger_lines;
      CREATE VIEW ledger_lines AS
        SELECT t.id AS transaction_id, NULL AS split_id, t.account_id, t.date,
               t.amount_cents, t.classification, t.category_id, t.status, t.merchant, t.trip_id,
               t.client_id, t.project_id, t.contractor_id
          FROM transactions t WHERE t.is_split = 0
        UNION ALL
        SELECT t.id, s.id, t.account_id, t.date,
               s.amount_cents, s.classification, s.category_id, t.status, t.merchant, t.trip_id,
               t.client_id, t.project_id, t.contractor_id
          FROM splits s JOIN transactions t ON t.id = s.transaction_id
         WHERE t.is_split = 1;
    `,
  },
  {
    version: 5,
    name: 'planning: account balances, subscription choices, budgets, planned items',
    sql: `
      ALTER TABLE accounts ADD COLUMN balance_cents INTEGER;
      ALTER TABLE accounts ADD COLUMN balance_date TEXT;

      CREATE TABLE subscription_prefs (
        series_key TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('keep','replace','cancelled','ignore')),
        note TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE budgets (
        id INTEGER PRIMARY KEY,
        scope TEXT NOT NULL CHECK (scope IN ('category','business_total','personal_total')),
        category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        monthly_cents INTEGER NOT NULL,
        UNIQUE (scope, category_id)
      );

      CREATE TABLE planned_items (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `,
  },
  {
    version: 6,
    name: 'taxes and retirement: tax profile, home office, retirement accounts',
    sql: `
      CREATE TABLE tax_profiles (
        year INTEGER PRIMARY KEY,
        filing_status TEXT NOT NULL DEFAULT 'single' CHECK (filing_status IN ('single','mfj','mfs','hoh')),
        w2_wages_cents INTEGER NOT NULL DEFAULT 0,
        other_income_cents INTEGER NOT NULL DEFAULT 0,
        withholding_cents INTEGER NOT NULL DEFAULT 0,
        prior_year_tax_cents INTEGER,
        prior_year_agi_cents INTEGER,
        state_rate_pct REAL NOT NULL DEFAULT 0,
        projection_mode TEXT NOT NULL DEFAULT 'pace' CHECK (projection_mode IN ('pace','ytd','manual')),
        projected_profit_cents INTEGER
      );

      CREATE TABLE home_office (
        year INTEGER PRIMARY KEY,
        method TEXT NOT NULL DEFAULT 'simplified' CHECK (method IN ('simplified','actual')),
        office_sqft REAL NOT NULL DEFAULT 0,
        home_sqft REAL NOT NULL DEFAULT 0,
        months_used INTEGER NOT NULL DEFAULT 12
      );

      CREATE TABLE retirement_accounts (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('sep_ira','solo_401k','traditional_ira','roth_ira','401k','hsa','brokerage','other')),
        balance_cents INTEGER NOT NULL DEFAULT 0,
        balance_date TEXT,
        expected_return_pct REAL NOT NULL DEFAULT 6,
        planned_annual_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE retirement_contributions (
        id INTEGER PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES retirement_accounts(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        amount_cents INTEGER NOT NULL,
        tax_year INTEGER NOT NULL,
        transaction_id INTEGER REFERENCES transactions(id) ON DELETE SET NULL,
        note TEXT
      );
      CREATE INDEX ix_retirement_contrib_tx ON retirement_contributions(transaction_id);
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
