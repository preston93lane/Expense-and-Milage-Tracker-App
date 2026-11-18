import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(here, '..', '..', '..', 'fixtures');

export function fixture(rel: string): string {
  return readFileSync(join(FIXTURES_DIR, rel), 'utf8');
}
