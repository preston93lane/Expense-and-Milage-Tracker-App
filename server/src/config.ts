import { existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where your data lives. Deliberately OUTSIDE the code folder so updates never
 * touch it, and deliberately NOT in "Documents" on Windows: Windows often syncs
 * Documents to OneDrive, which would upload your bank data to the cloud.
 *
 *   Windows: %LOCALAPPDATA%\ExpenseTracker   (e.g. C:\Users\you\AppData\Local\ExpenseTracker)
 *   macOS:   ~/Library/Application Support/ExpenseTracker
 *   Linux:   ~/.local/share/expense-tracker
 *
 * Override with the ET_DATA_DIR environment variable (used by tests).
 */
export function resolveDataDir(): string {
  if (process.env.ET_DATA_DIR) return resolve(process.env.ET_DATA_DIR);
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'ExpenseTracker');
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'ExpenseTracker');
    default:
      return join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'expense-tracker');
  }
}

export interface AppPaths {
  dataDir: string;
  dbPath: string;
  backupsDir: string;
  importsDir: string;
}

export function appPaths(dataDir = resolveDataDir()): AppPaths {
  const paths = {
    dataDir,
    dbPath: join(dataDir, 'data.db'),
    backupsDir: join(dataDir, 'backups'),
    importsDir: join(dataDir, 'imports'),
  };
  for (const d of [paths.dataDir, paths.backupsDir, paths.importsDir]) {
    if (!existsSync(d)) mkdirSync(d, { recursive: true });
  }
  return paths;
}

export const DEFAULT_PORT = Number(process.env.ET_PORT || 4280);

/** Only ever listen on the local machine unless Wi-Fi mode is switched on (Phase 6). */
export const DEFAULT_HOST = '127.0.0.1';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..');
export const WEB_DIST = join(REPO_ROOT, 'web', 'dist');

export const APP_VERSION = '0.1.0';
