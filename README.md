# Expense & Mileage Tracker

A private, local-only replacement for QuickBooks Self-Employed. It covers business expenses, mileage and self-employed tax reports.

- **Runs only on your computer.** There's no bank linking, no cloud and no analytics. The app makes no internet requests. Your data is one file on your PC.
- **Monthly bank files instead of bank logins.** You import CSV or Quicken/QuickBooks (.QFX/.QBO/.OFX) downloads. Overlapping date ranges are safe because duplicates are skipped.
- **Sorts itself over time.** Your rules run first, then "how you handled this merchant before", then built-in merchant knowledge. Anything uncertain goes to **Needs Review**.

## Status

| Phase | What | Status |
|---|---|---|
| 0 | Foundation: local server, database, backups, Windows launcher, CI | ✅ |
| 1 | Bank import (CSV/OFX/QFX/QBO), transaction ledger, splits, transfers, cash entries | ✅ |
| 2 | Auto-categorisation, rules, Needs Review with keyboard shortcuts, undo | ✅ |
| 3 | Business trips: group a date range + location, pre-trip bookings | next |
| 4 | Mileage: import Google Maps Timeline (iPhone), review drives, manual entry | planned |
| 5 | Reports: Schedule C summary, P&L, mileage log, quarterly estimates, home office | planned |
| 6 | iPhone/iPad: home Wi-Fi access + offline Quick Log | planned |
| 7 | One-file Windows install, scheduled encrypted backups, year lock | planned |

## Install on Windows (one time)

1. Install **Node.js LTS** from <https://nodejs.org> (accept the defaults).
2. Get this folder onto your PC: **Code → Download ZIP** on GitHub, then unzip it somewhere like `C:\ExpenseTracker`. Or use `git clone` if you have Git.
3. Double-click **`Start Expense Tracker.bat`**. The first run installs components (about a minute). After that your browser opens the app at `http://127.0.0.1:4280`.
4. Optional: double-click **`Create Desktop Shortcut.bat`**.

Closing the black console window stops the app.

### Updating

Double-click **`Update Expense Tracker.bat`** (Git installs), or download the new ZIP and unzip it over the old folder. Your data is stored elsewhere and is never touched by updates. A backup is made automatically before any data-format upgrade.

## Where your data lives

| | |
|---|---|
| Windows | `%LOCALAPPDATA%\ExpenseTracker\` (e.g. `C:\Users\you\AppData\Local\ExpenseTracker`) |
| Database | `data.db`, a single SQLite file |
| Backups | `backups\` (Settings → Back up now; automatic before upgrades and restores) |
| Original bank files | `imports\`, a private copy of each file you imported |

It's deliberately **not** in Documents, because Windows often syncs Documents to OneDrive. Copy the `backups` folder to a USB drive now and then. Turning on BitLocker or Device Encryption protects the data if the laptop is lost.

## Monthly routine (about 10 minutes once rules are set up)

1. Download last month's statement from each bank and card. Use the CSV, or the **Quicken/QuickBooks (.QFX/.QBO)** download if your bank offers it (that format has unique transaction IDs).
2. **Import bank files:** drop them in, pick the account, check the preview, then import.
3. **Needs Review:** press **B** for business, **P** for personal, **T** for transfer, **1–9** for a quick category, **A** to approve a suggestion, **S** to skip, **U** to undo, and **R** to tick "always do this for this merchant" (it creates a rule). "Group by merchant" plus "also apply to N other …" clears repeats in one keypress.
4. For a work trip, go to **Transactions**, pick the date range, select all, and press **Business**. Dedicated trip grouping, which also finds flights and hotels booked earlier, is the next phase.

## Privacy and security details

- The server listens on `127.0.0.1` only, so other devices can't reach it. Opt-in home Wi-Fi access for iPhone/iPad comes in Phase 6, with a passcode.
- Requests with an unexpected `Host` header (DNS rebinding) or a foreign `Origin` are rejected. Writes must be JSON, so a website you visit can't silently post to the app.
- A strict Content-Security-Policy allows the page to talk only to the local server. The automated browser test fails if the page makes any request off the computer.
- The repository never holds data: `.gitignore` blocks databases, statements and Timeline files, and tests use made-up files in `fixtures/` only.

## Development

```bash
npm install
npm test               # unit + API tests (Vitest)
npm run typecheck
npm run build:web
npm run serve          # http://127.0.0.1:4280 (set ET_DATA_DIR to use a scratch data folder)
npm run dev:server & npm run dev:web   # hot-reload UI on http://127.0.0.1:5173
npm run test:e2e       # Playwright end-to-end + privacy check (needs Playwright installed)
```

Layout:

- `core/` contains the pure logic: parsers, merchant cleanup, rules, tax tables.
- `server/` holds the Fastify API and SQLite migrations.
- `web/` is the React + Mantine UI.
- `fixtures/` holds made-up sample files.

This is bookkeeping software, not tax advice. Category-to-form-line mappings follow common Schedule C practice. Confirm anything unusual with a tax professional.
