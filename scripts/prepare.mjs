// Makes sure dependencies are installed and the web interface is built and
// up to date. Run by the Windows launcher before starting the app; safe to run
// any time. Only talks to the internet (the npm registry) when installing packages.
//
// Freshness is checked by content hash, not file dates, so it works the same
// after `git pull` or after unzipping a newer download over the old folder.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

function hashFiles(paths) {
  const h = createHash('sha256');
  const walk = (p) => {
    if (!existsSync(p)) return;
    const entries = readdirSync(p, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const full = join(p, e.name);
      if (e.isDirectory()) walk(full);
      else {
        h.update(relative(root, full).replace(/\\/g, '/'));
        h.update(readFileSync(full));
      }
    }
  };
  for (const p of paths) {
    const full = join(root, p);
    if (!existsSync(full)) continue;
    if (p.includes('.')) {
      h.update(p);
      h.update(readFileSync(full));
    } else walk(full);
  }
  return h.digest('hex');
}

const readStamp = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim() : '');

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) {
  console.error(`\n  Node.js 22 or newer is required (you have ${process.versions.node}).`);
  console.error('  Install the current "LTS" version from https://nodejs.org and try again.\n');
  process.exit(1);
}

// 1. Dependencies
const depsHash = hashFiles(['package-lock.json']);
const depsStamp = join(root, 'node_modules', '.et-install-stamp');
if (readStamp(depsStamp) !== depsHash) {
  console.log('\n  Installing app components (first run or after an update — about a minute)...\n');
  run('npm ci --no-audit --no-fund');
  writeFileSync(depsStamp, depsHash);
}

// 2. Web interface
const webHash = hashFiles(['package-lock.json', 'web/index.html', 'web/vite.config.ts', 'web/public', 'web/src', 'core/src']);
const webStamp = join(root, 'web', 'dist', '.build-stamp');
if (!existsSync(join(root, 'web', 'dist', 'index.html')) || readStamp(webStamp) !== webHash) {
  console.log('\n  Building the interface...\n');
  run('npm run build:web');
  writeFileSync(webStamp, webHash);
}
