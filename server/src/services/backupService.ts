import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AppContext } from '../context';
import { openDatabase } from '../db/database';

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

export async function createBackup(ctx: AppContext, label = 'manual') {
  const safe = label.replace(/[^\w-]+/g, '-').slice(0, 40) || 'manual';
  const name = `${safe}-${stamp()}.db`;
  const file = join(ctx.paths.backupsDir, name);
  await ctx.db.backup(file);
  const st = statSync(file);
  return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
}

export function listBackups(ctx: AppContext) {
  if (!existsSync(ctx.paths.backupsDir)) return [];
  return readdirSync(ctx.paths.backupsDir)
    .filter((f) => f.endsWith('.db'))
    .map((name) => {
      const st = statSync(join(ctx.paths.backupsDir, name));
      return { name, sizeBytes: st.size, createdAt: st.mtime.toISOString() };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Replace the current data with a backup. A safety backup of the current data
 * is taken first, so a restore can itself be undone.
 */
export async function restoreBackup(ctx: AppContext, name: string) {
  const clean = basename(name);
  const src = join(ctx.paths.backupsDir, clean);
  if (!clean.endsWith('.db') || !existsSync(src)) throw new Error('Backup not found.');
  const safety = await createBackup(ctx, 'before-restore');
  ctx.db.close();
  for (const suffix of ['-wal', '-shm']) {
    const f = ctx.paths.dbPath + suffix;
    if (existsSync(f)) rmSync(f);
  }
  copyFileSync(src, ctx.paths.dbPath);
  ctx.db = await openDatabase(ctx.paths.dbPath, ctx.paths.backupsDir);
  return { restored: clean, safetyBackup: safety.name };
}
