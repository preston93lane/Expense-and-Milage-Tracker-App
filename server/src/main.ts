import { dailyBackup } from './services/backupService';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { platform } from 'node:os';
import { buildApp } from './app';
import { appPaths, DEFAULT_HOST, DEFAULT_PORT } from './config';
import type { AppContext } from './context';
import { openDatabase } from './db/database';

function openBrowser(url: string) {
  if (process.env.ET_NO_BROWSER === '1') return;
  const p = platform();
  const [cmd, args] =
    // On Windows the empty string becomes the (blank) window title that `start` expects.
    p === 'win32' ? ['cmd', ['/c', 'start', '', url]] : p === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args as string[], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* no browser available; the URL is printed below */
  }
}

function alreadyRunning(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(`${url}/api/health`, { timeout: 1500 }, (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function main() {
  const port = DEFAULT_PORT;
  const url = `http://${DEFAULT_HOST}:${port}`;
  if (await alreadyRunning(url)) {
    console.log(`Expense Tracker is already running at ${url} — opening it.`);
    openBrowser(url);
    return;
  }

  const paths = appPaths();
  const db = await openDatabase(paths.dbPath, paths.backupsDir);
  const ctx: AppContext = { db, paths, port };
  const app = await buildApp(ctx);
  // A fresh copy of your data each day, kept for two weeks (Settings → Backups).
  await dailyBackup(ctx).catch((e) => console.error('Daily backup failed:', (e as Error).message));
  await app.listen({ host: DEFAULT_HOST, port });

  console.log('');
  console.log('  Expense & Mileage Tracker is running.');
  console.log(`  Open:        ${url}`);
  console.log(`  Your data:   ${paths.dataDir}`);
  console.log('  Private:     listening on this computer only; nothing is sent anywhere.');
  console.log('  To stop it:  close this window (or press Ctrl+C).');
  console.log('');
  openBrowser(url);

  const shutdown = async () => {
    try {
      await app.close();
      ctx.db.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Could not start Expense Tracker:', err?.message ?? err);
  process.exit(1);
});
