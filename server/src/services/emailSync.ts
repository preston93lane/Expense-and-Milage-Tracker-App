import { ImapFlow } from 'imapflow';
import type { AppPaths } from '../config';
import { getSetting, setSetting, type DB } from '../db/database';
import { ingestReceipt } from './receiptService';

/**
 * Pull receipt emails straight from YOUR mailbox over IMAP (opt-in).
 * The only connection made is to your own email provider; nothing else is sent anywhere.
 * Gmail / iCloud / Zoho / Yahoo need an "app password" (with 2-step verification on).
 */
export interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
  lookbackDays: number;
  rememberPassword: boolean;
}

export const PROVIDERS: Record<string, { host: string; port: number; mailbox: string; help: string }> = {
  gmail: { host: 'imap.gmail.com', port: 993, mailbox: '[Gmail]/All Mail', help: 'Google Account → Security → 2-Step Verification → App passwords. Create one called “Expense Tracker”.' },
  icloud: { host: 'imap.mail.me.com', port: 993, mailbox: 'INBOX', help: 'appleid.apple.com → Sign-In and Security → App-Specific Passwords.' },
  zoho: { host: 'imap.zoho.com', port: 993, mailbox: 'INBOX', help: 'Enable IMAP in Zoho Mail settings; with 2FA create an application-specific password.' },
  yahoo: { host: 'imap.mail.yahoo.com', port: 993, mailbox: 'INBOX', help: 'Yahoo Account Security → Generate app password.' },
};

const SUBJECT_WORDS = ['receipt', 'invoice', 'order', 'confirmation', 'itinerary', 'booking', 'reservation', 'e-ticket', 'your trip', 'payment', 'rental', 'purchase'];

export function emailSettings(db: DB): EmailSettings & { hasSavedPassword: boolean; lastSync: string | null } {
  return {
    host: getSetting(db, 'email_imap_host', ''),
    port: getSetting(db, 'email_imap_port', 993),
    secure: getSetting(db, 'email_imap_secure', true),
    user: getSetting(db, 'email_imap_user', ''),
    mailbox: getSetting(db, 'email_imap_mailbox', 'INBOX'),
    lookbackDays: getSetting(db, 'email_lookback_days', 120),
    rememberPassword: getSetting(db, 'email_remember_password', false),
    hasSavedPassword: !!getSetting<string | null>(db, 'email_imap_password', null),
    lastSync: getSetting<string | null>(db, 'email_last_sync', null),
  };
}

export function saveEmailSettings(db: DB, s: Partial<EmailSettings>): void {
  if (s.host !== undefined) setSetting(db, 'email_imap_host', s.host.trim());
  if (s.port !== undefined) setSetting(db, 'email_imap_port', s.port);
  if (s.secure !== undefined) setSetting(db, 'email_imap_secure', s.secure);
  if (s.user !== undefined) setSetting(db, 'email_imap_user', s.user.trim());
  if (s.mailbox !== undefined) setSetting(db, 'email_imap_mailbox', s.mailbox.trim() || 'INBOX');
  if (s.lookbackDays !== undefined) setSetting(db, 'email_lookback_days', s.lookbackDays);
  if (s.rememberPassword !== undefined) {
    setSetting(db, 'email_remember_password', s.rememberPassword);
    if (!s.rememberPassword) setSetting(db, 'email_imap_password', null);
  }
}

export interface SyncResult {
  checked: number;
  imported: number;
  duplicates: number;
  noTotal: number;
  matched: number;
}

export async function syncEmailReceipts(db: DB, paths: AppPaths, password?: string | null): Promise<SyncResult> {
  const s = emailSettings(db);
  const pass = password || getSetting<string | null>(db, 'email_imap_password', null);
  if (!s.host || !s.user) throw new Error('Fill in the email settings first.');
  if (!pass) throw new Error('Enter your app password.');
  if (password && s.rememberPassword) setSetting(db, 'email_imap_password', password);

  const client = new ImapFlow({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass }, logger: false });
  const result: SyncResult = { checked: 0, imported: 0, duplicates: 0, noTotal: 0, matched: 0 };
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`Couldn't sign in to ${s.host}: ${(e as Error).message}. Check the address and app password.`);
  }
  const lock = await client.getMailboxLock(s.mailbox);
  try {
    const last = getSetting<string | null>(db, 'email_last_sync', null);
    const since = new Date(Date.now() - s.lookbackDays * 86_400_000);
    const from = last && new Date(last) > since ? new Date(new Date(last).getTime() - 3 * 86_400_000) : since;
    const query = s.host.includes('gmail.com')
      ? { gmraw: `after:${from.toISOString().slice(0, 10).replace(/-/g, '/')} (category:purchases OR subject:(${SUBJECT_WORDS.map((w) => `"${w}"`).join(' OR ')}))` }
      : { since: from, or: SUBJECT_WORDS.map((w) => ({ subject: w })) };
    const found = await client.search(query as never, { uid: true });
    const uids = (Array.isArray(found) ? found : []).slice(-400);
    for await (const msg of client.fetch(uids, { source: true, envelope: true }, { uid: true })) {
      result.checked++;
      if (!msg.source) continue;
      const subject = (msg.envelope?.subject ?? 'receipt').replace(/[^\w -]+/g, '').slice(0, 60);
      const date = new Date(msg.envelope?.date ?? Date.now()).toISOString().slice(0, 10);
      const r = await ingestReceipt(db, paths, { fileName: `${date} ${subject}.eml`, buffer: Buffer.from(msg.source), source: 'email' });
      if (r.duplicate) {
        result.duplicates++;
        continue;
      }
      const row = db.prepare('SELECT total_cents, match_status FROM receipts WHERE id = ?').get(r.id) as { total_cents: number | null; match_status: string };
      if (!row.total_cents) {
        // Marketing emails with "order" in the subject etc. — keep, but out of the way.
        db.prepare("UPDATE receipts SET match_status = 'ignored' WHERE id = ?").run(r.id);
        result.noTotal++;
        continue;
      }
      result.imported++;
      if (row.match_status === 'matched') result.matched++;
    }
  } finally {
    lock.release();
    await client.logout().catch(() => undefined);
  }
  setSetting(db, 'email_last_sync', new Date().toISOString());
  return result;
}
