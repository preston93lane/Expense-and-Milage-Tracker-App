import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CATEGORIES, DEFAULT_MILEAGE_RATES } from '@et/core';
import { LATEST_VERSION, MIGRATIONS } from './migrations';

export type DB = Database.Database;

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

/** Open (creating if needed) and migrate the database. Backs up before migrating existing data. */
export async function openDatabase(dbPath: string, backupsDir?: string): Promise<DB> {
  const isNew = dbPath === ':memory:' || !existsSync(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const current = db.pragma('user_version', { simple: true }) as number;
  if (current > LATEST_VERSION) {
    db.close();
    throw new Error(
      `This data file was created by a newer version of the app (schema v${current}). Update the app before opening it.`,
    );
  }
  if (current < LATEST_VERSION && !isNew && current > 0 && backupsDir) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    await db.backup(join(backupsDir, `before-upgrade-v${current}-to-v${LATEST_VERSION}-${timestamp()}.db`));
  }
  migrate(db, current);
  return db;
}

export function migrate(db: DB, fromVersion: number): void {
  const pending = MIGRATIONS.filter((m) => m.version > fromVersion);
  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      if (m.version === 1) seed(db);
      db.pragma(`user_version = ${m.version}`);
    })();
  }
}

function seed(db: DB): void {
  const insertCat = db.prepare(`
    INSERT INTO categories (key, name, kind, tax_line, deductible_pct, description, aliases, sort_order, is_system)
    VALUES (@key, @name, @kind, @taxLine, @deductiblePct, @description, @aliases, @sortOrder, 1)
  `);
  DEFAULT_CATEGORIES.forEach((c, i) =>
    insertCat.run({ ...c, aliases: JSON.stringify(c.aliases ?? []), sortOrder: (i + 1) * 10 }),
  );
  const insertRate = db.prepare(`
    INSERT INTO mileage_rates (kind, effective_from, effective_to, cents_per_mile, note)
    VALUES (@kind, @effectiveFrom, @effectiveTo, @centsPerMile, @note)
  `);
  for (const r of DEFAULT_MILEAGE_RATES) insertRate.run({ note: null, ...r });
  const setSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
  setSetting.run('mileage_method', JSON.stringify('standard'));
  setSetting.run('trip_window_before_days', JSON.stringify(60));
  setSetting.run('trip_window_after_days', JSON.stringify(5));
}

export function getSetting<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export function setSetting(db: DB, key: string, value: unknown): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value),
  );
}
