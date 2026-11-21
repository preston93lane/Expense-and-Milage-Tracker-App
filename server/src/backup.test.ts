import { existsSync, mkdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyBackup, listBackups } from './services/backupService';
import { makeTestApp, type TestApp } from './test/helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
  if (!existsSync(t.ctx.paths.backupsDir)) mkdirSync(t.ctx.paths.backupsDir, { recursive: true });
});
afterEach(async () => {
  await t.close();
});

describe('daily backup', () => {
  it('backs up once a day on startup', async () => {
    expect(await dailyBackup(t.ctx)).not.toBeNull();
    expect(await dailyBackup(t.ctx)).toBeNull();
    expect(listBackups(t.ctx).filter((b) => b.name.startsWith('auto-daily-'))).toHaveLength(1);
  });

  it('keeps only the newest copies', async () => {
    for (let i = 0; i < 4; i++) {
      await dailyBackup(t.ctx, 2, Date.now() + (i + 1) * 86_400_000);
      await new Promise((r) => setTimeout(r, 1100)); // distinct file names (second resolution)
    }
    expect(listBackups(t.ctx).filter((b) => b.name.startsWith('auto-daily-'))).toHaveLength(2);
  });
});
