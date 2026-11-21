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
| 3 | Business trips: date range + location grouping, pre-trip bookings, late hotel bills, automatic trip suggestions | ✅ |
| 4 | Mileage: import Google Maps Timeline (iPhone), review and edit drives, Google route lookup, manual entry | next |
| 5 | Reports and taxes (see below) | ✅ (mileage lines fill in once Phase 4 is done) |
| 6 | iPhone/iPad: home Wi-Fi access + offline Quick Log | planned |
| 7 | One-file Windows install, scheduled encrypted backups, year lock | planned |

### What's in the app

| Area | Pages | What it does |
|---|---|---|
| Money in | Income, Clients, Invoices | Income by client and month, income goal, invoices with payments matched to deposits, retainers, which 1099-NECs/1099-Ks to expect |
| Business | Time tracking | Timer or manual entries per client/project/trip, billable rates, weekly hours, where your time goes, unbilled time → draft invoice |
| | Profitability | What each client and project really pays per hour after direct costs, against your target rate; car: standard mileage rate vs actual costs |
| | Business trips | Trip grouping plus profit per trip (income, costs, margin, per day) and trip-to-trip comparison |
| | Contractors & 1099s | W-9 tracking and who needs a 1099-NEC ($600 through 2025, $2,000 from 2026), excluding card/PayPal payments |
| | Receipts | Attach PDFs/photos/emails, read the total and date, auto-match to transactions; optional email collection (below) |
| | Equipment | Register of gear with de minimis / Section 179 / 100% bonus / MACRS / straight-line write-offs (Schedule C line 13), business-use %, warranty and replacement reminders, printable gear list for insurance |
| Planning | Cash flow, Budgets, Subscriptions | 90-day balance forecast (bills, retainers, tax payments), monthly budgets with pace, recurring charges with ideas for replacing them with your own tools |
| | Taxes | Schedule C summary, quarterly estimated taxes with safe harbor, home office, year-end tax packet (Excel) |
| | Retirement | SEP-IRA / Solo 401(k) limits from your profit, planned vs actual contributions, projection to retirement |

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
| Backups | `backups\` (automatic once a day when the app starts, last 14 kept; also Settings → Back up now, and before upgrades and restores) |
| Original bank files | `imports\`, a private copy of each file you imported |

It's deliberately **not** in Documents, because Windows often syncs Documents to OneDrive. Copy the `backups` folder to a USB drive now and then. Turning on BitLocker or Device Encryption protects the data if the laptop is lost.

## Monthly routine (about 10 minutes once rules are set up)

1. Download last month's statement from each bank and card. Use the CSV, or the **Quicken/QuickBooks (.QFX/.QBO)** download if your bank offers it (that format has unique transaction IDs).
2. **Import bank files:** drop them in, pick the account, check the preview, then import.
3. **Needs Review:** press **B** for business, **P** for personal, **T** for transfer, **1–9** for a quick category, **A** to approve a suggestion, **S** to skip, **U** to undo, and **R** to tick "always do this for this merchant" (it creates a rule). "Group by merchant" plus "also apply to N other …" clears repeats in one keypress.
4. **Business trips:** the app suggests likely trips from out-of-state card activity ("Looks like a trip to Columbus, OH, Nov 3–5"). You can also create one yourself with the dates, city/state and business purpose. It gathers:
   - everything you spent there
   - flights and hotels booked beforehand
   - hotel and rental-car bills that post after you get home

   It uses trip-aware categories (meals → travel meals 50%, gas → rental-car fuel), leaves spending back home and subscriptions unticked, and doesn't tick a flight that was probably for an earlier trip. Untick anything personal, add the rest, and print the trip report. Transactions imported later that fall inside a trip are suggested for it automatically.

## Privacy and security details

- The server listens on `127.0.0.1` only, so other devices can't reach it. Opt-in home Wi-Fi access for iPhone/iPad comes in Phase 6, with a passcode.
- Requests with an unexpected `Host` header (DNS rebinding) or a foreign `Origin` are rejected. Writes must be JSON, so a website you visit can't silently post to the app.
- A strict Content-Security-Policy allows the page to talk only to the local server. The automated browser test fails if the page makes any request off the computer.
- **The one opt-in exception: email receipts.** If you turn on Receipts → "Collect from email", the app signs in to *your own* mailbox (Gmail, iCloud, Zoho, Yahoo… over IMAP with an app password) and downloads receipt emails to your PC. Nothing is sent anywhere else. Leave it off and the app never goes online.
- Receipt emails and web pages are stored as files and opened as downloads, never displayed inside the app, so a hostile email can't run anything.
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

- `core/` contains the pure logic: parsers, merchant cleanup, rules, trips, tax tables and estimates, depreciation, recurring-charge detection, receipts, time and profitability math.
- `server/` holds the Fastify API and SQLite migrations.
- `web/` is the React + Mantine UI.
- `fixtures/` holds made-up sample files.

Tax figures are kept in `core/src/tax/` (brackets, standard deduction, Social Security wage base, retirement limits, mileage rates, 1099 thresholds) and need a yearly update. Years without a table fall back to the latest one and say so on the page.

This is bookkeeping software, not tax advice. Category-to-form-line mappings follow common Schedule C practice. Confirm anything unusual with a tax professional.
