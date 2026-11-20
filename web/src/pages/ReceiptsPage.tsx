import {
  Alert,
  Anchor,
  Badge,
  Button,
  Code,
  Drawer,
  Group,
  NumberInput,
  Paper,
  PasswordInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconFileUpload, IconFolder, IconLock, IconMail, IconPaperclip, IconTrash } from '@tabler/icons-react';
import { useEffect, useRef, useState } from 'react';
import { api, type Receipt, type ReceiptDetail, type Transaction } from '../api';
import { Money, PageHeader } from '../components/bits';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { useUploadReceipts } from '../components/ReceiptsSection';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

const STATUS: Record<Receipt['matchStatus'], [string, string]> = {
  matched: ['Matched', 'teal'],
  suggested: ['Check match', 'orange'],
  unmatched: ['No match yet', 'gray'],
  ignored: ['Ignored', 'gray'],
};

export function ReceiptsPage() {
  const [tab, setTab] = useState<'review' | 'matched' | 'ignored' | 'missing'>('review');
  const year = new Date().getFullYear();
  const list = useQuery({ queryKey: ['receipts', 'all'], queryFn: () => api.get<{ receipts: Receipt[]; counts: Record<string, number> }>('/api/receipts') });
  const missing = useQuery({ queryKey: ['receipts', 'missing', year], queryFn: () => api.get<Transaction[]>(`/api/receipts/missing?year=${year}`) });
  const upload = useUploadReceipts();
  const refresh = useRefreshAll();
  const inputRef = useRef<HTMLInputElement>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [txId, setTxId] = useState<number | null>(null);
  const scan = useMutation({
    mutationFn: () => api.post<{ imported: number; duplicates: number; skipped: string[]; folder: string }>('/api/receipts/scan-inbox'),
    onSuccess: (r) => {
      refresh();
      notifications.show({ color: 'teal', message: `Receipts folder: ${r.imported} new, ${r.duplicates} already had${r.skipped.length ? `, skipped ${r.skipped.join(', ')}` : ''}` });
    },
    onError: notifyError,
  });

  const all = list.data?.receipts ?? [];
  const shown =
    tab === 'review'
      ? all.filter((r) => r.matchStatus === 'suggested' || r.matchStatus === 'unmatched')
      : tab === 'matched'
        ? all.filter((r) => r.matchStatus === 'matched')
        : all.filter((r) => r.matchStatus === 'ignored');
  const c = list.data?.counts ?? {};

  return (
    <>
      <PageHeader
        title="Receipts"
        description="Keep the receipt next to each expense — the IRS wants them for lodging and anything $75 or more. Drop in PDFs, photos, saved emails (.eml) or receipt pages; or let the app collect receipt emails from your inbox. Each one is matched to its bank transaction by amount, date and merchant."
        right={
          <Group>
            <Button variant="default" leftSection={<IconFolder size={16} />} loading={scan.isPending} onClick={() => scan.mutate()}>
              Check receipts folder
            </Button>
            <Button leftSection={<IconFileUpload size={16} />} loading={upload.isPending} onClick={() => inputRef.current?.click()}>
              Add receipts
            </Button>
            <input
              ref={inputRef}
              type="file"
              hidden
              multiple
              accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.eml,.html,.htm,.txt"
              data-testid="receipt-input"
              onChange={(e) => {
                const files = [...(e.currentTarget.files ?? [])];
                if (files.length) upload.mutate(files);
                e.currentTarget.value = '';
              }}
            />
          </Group>
        }
      />
      <Stack>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Stat label="Matched" value={c.matched ?? 0} />
          <Stat label="Need a look" value={(c.suggested ?? 0) + (c.unmatched ?? 0)} />
          <Stat label={`Missing (${year})`} value={missing.data?.length ?? 0} hint="Business ≥ $75 or lodging" />
          <Stat label="Ignored" value={c.ignored ?? 0} />
        </SimpleGrid>

        <SegmentedControl
          w="fit-content"
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          data={[
            { value: 'review', label: 'Need a look' },
            { value: 'matched', label: 'Matched' },
            { value: 'missing', label: 'Missing receipts' },
            { value: 'ignored', label: 'Ignored' },
          ]}
        />

        {tab !== 'missing' ? (
          <Paper withBorder>
            <Table.ScrollContainer minWidth={760}>
              <Table fz="sm" verticalSpacing="xs" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Receipt</Table.Th>
                    <Table.Th>Date</Table.Th>
                    <Table.Th ta="right">Total</Table.Th>
                    <Table.Th>Matched to</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {shown.map((r) => (
                    <Table.Tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setOpenId(r.id)}>
                      <Table.Td>
                        <Text size="sm" fw={500}>{r.merchant ?? r.fileName}</Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {r.source === 'email' ? `Email: ${r.emailSubject ?? ''}` : r.fileName}
                        </Text>
                      </Table.Td>
                      <Table.Td>{r.receiptDate ? shortDate(r.receiptDate) : '—'}</Table.Td>
                      <Table.Td ta="right" ff="monospace">{r.totalCents !== null ? money(r.totalCents) : '—'}</Table.Td>
                      <Table.Td>
                        {r.transaction ? (
                          <Text size="xs">
                            {r.transaction.merchant} · {shortDate(r.transaction.date)} · {money(r.transaction.amountCents)}
                          </Text>
                        ) : (
                          <Text size="xs" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={STATUS[r.matchStatus][1]} variant="light">{STATUS[r.matchStatus][0]}</Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {shown.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={5}>
                        <Text c="dimmed" ta="center" py="lg" size="sm">Nothing here.</Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        ) : (
          <Paper withBorder>
            <Table fz="sm" verticalSpacing="xs" highlightOnHover>
              <Table.Tbody>
                {(missing.data ?? []).map((t) => (
                  <Table.Tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setTxId(t.id)}>
                    <Table.Td w={110}>{shortDate(t.date)}</Table.Td>
                    <Table.Td>{t.merchant}</Table.Td>
                    <Table.Td ta="right"><Money cents={t.amountCents} size="sm" /></Table.Td>
                    <Table.Td w={160}><Text size="xs" c="dimmed">Click to attach a receipt</Text></Table.Td>
                  </Table.Tr>
                ))}
                {missing.data?.length === 0 && (
                  <Table.Tr><Table.Td><Text c="dimmed" ta="center" py="lg" size="sm">Every business expense of $75+ (and every hotel stay) has a receipt. 🎉</Text></Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Paper>
        )}

        <EmailSync />
      </Stack>
      {openId !== null && <ReceiptDrawer id={openId} onClose={() => setOpenId(null)} />}
      <TransactionDrawer id={txId} onClose={() => setTxId(null)} />
    </>
  );
}

function ReceiptDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const refresh = useRefreshAll();
  const { data, refetch } = useQuery({ queryKey: ['receipts', 'one', id], queryFn: () => api.get<ReceiptDetail>(`/api/receipts/${id}`) });
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState('');
  const [total, setTotal] = useState<number | string>('');
  useEffect(() => {
    if (!data) return;
    setMerchant(data.merchant ?? '');
    setDate(data.receiptDate ?? '');
    setTotal(data.totalCents !== null ? data.totalCents / 100 : '');
  }, [data]);
  const done = () => {
    refresh();
    void refetch();
  };
  const save = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) =>
      api.patch(`/api/receipts/${id}`, { merchant, receiptDate: date || null, totalCents: total === '' ? null : Math.round(Number(total) * 100), ...extra }),
    onSuccess: done,
    onError: notifyError,
  });
  const link = useMutation({ mutationFn: (transactionId: number | null) => api.post(`/api/receipts/${id}/link`, { transactionId }), onSuccess: done, onError: notifyError });
  const del = useMutation({
    mutationFn: () => api.del(`/api/receipts/${id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={<Text fw={700}>Receipt</Text>}>
      {data && (
        <Stack>
          <Group justify="space-between">
            <Badge color={STATUS[data.matchStatus][1]} variant="light" size="lg">{STATUS[data.matchStatus][0]}</Badge>
            <Anchor href={`/api/receipts/${id}/file`} target="_blank" rel="noreferrer" size="sm">
              <Group gap={4}><IconPaperclip size={14} /> Open {data.fileName}</Group>
            </Anchor>
          </Group>
          {data.emailFrom && <Text size="xs" c="dimmed">From {data.emailFrom} — “{data.emailSubject}”</Text>}
          <SimpleGrid cols={3} spacing="xs">
            <TextInput label="Merchant" value={merchant} onChange={(e) => setMerchant(e.currentTarget.value)} />
            <TextInput label="Date" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
            <NumberInput label="Total" prefix="$" decimalScale={2} value={total} onChange={setTotal} />
          </SimpleGrid>
          <Group gap="xs">
            <Button size="xs" variant="default" onClick={() => save.mutate({})}>Save &amp; re-match</Button>
            {data.matchStatus !== 'ignored' ? (
              <Button size="xs" variant="subtle" color="gray" onClick={() => save.mutate({ matchStatus: 'ignored' })}>Ignore (not a receipt)</Button>
            ) : (
              <Button size="xs" variant="subtle" onClick={() => save.mutate({ matchStatus: 'unmatched' })}>Un-ignore</Button>
            )}
            <Button size="xs" variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => del.mutate()}>Delete</Button>
          </Group>

          {data.transaction && (
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed">Attached to</Text>
              <Group justify="space-between">
                <Text size="sm">{data.transaction.merchant} · {shortDate(data.transaction.date)}</Text>
                <Group gap="xs">
                  <Money cents={data.transaction.amountCents} size="sm" />
                  <Button size="compact-xs" variant="subtle" color="gray" onClick={() => link.mutate(null)}>Unlink</Button>
                </Group>
              </Group>
            </Paper>
          )}
          {data.matchStatus !== 'matched' && (
            <Paper withBorder p="sm">
              <Text size="sm" fw={600} mb={4}>Possible matches</Text>
              {data.candidates.length === 0 && <Text size="xs" c="dimmed">No transaction with this amount yet — it'll match automatically when you import the statement it's on.</Text>}
              {data.candidates.map((c) => (
                <Group key={c.transactionId} justify="space-between" py={4}>
                  <div>
                    <Text size="sm">{c.transaction?.merchant} · {c.transaction && shortDate(c.transaction.date)} · {c.transaction && money(c.transaction.amountCents)}</Text>
                    <Text size="xs" c="dimmed">{c.reasons.join(', ')} · {c.score}% match</Text>
                  </div>
                  <Button size="compact-xs" onClick={() => link.mutate(c.transactionId)}>This one</Button>
                </Group>
              ))}
            </Paper>
          )}
          {data.text && (
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed" mb={4}>Text read from the receipt</Text>
              <Code block style={{ maxHeight: 260, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{data.text}</Code>
            </Paper>
          )}
          {!data.hasText && <Alert variant="light" color="gray" p="xs"><Text size="xs">Photos aren't read automatically yet — type the merchant, date and total above and it will match.</Text></Alert>}
        </Stack>
      )}
    </Drawer>
  );
}

interface EmailSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  mailbox: string;
  lookbackDays: number;
  rememberPassword: boolean;
  hasSavedPassword: boolean;
  lastSync: string | null;
  inboxFolder: string;
  providers: Record<string, { host: string; port: number; mailbox: string; help: string }>;
}

function EmailSync() {
  const refresh = useRefreshAll();
  const { data, refetch } = useQuery({ queryKey: ['receipts', 'email-settings'], queryFn: () => api.get<EmailSettings>('/api/receipts/email-settings') });
  const [f, setF] = useState<Partial<EmailSettings>>({});
  const [provider, setProvider] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  useEffect(() => {
    if (!data) return;
    setF(data);
    setProvider(Object.entries(data.providers).find(([, p]) => p.host === data.host)?.[0] ?? (data.host ? 'other' : null));
  }, [data]);
  const save = useMutation({ mutationFn: () => api.put('/api/receipts/email-settings', f), onSuccess: () => void refetch(), onError: notifyError });
  const sync = useMutation({
    mutationFn: async () => {
      await api.put('/api/receipts/email-settings', f);
      return api.post<{ checked: number; imported: number; duplicates: number; noTotal: number; matched: number }>('/api/receipts/email-sync', { password });
    },
    onSuccess: (r) => {
      setPassword('');
      refresh();
      void refetch();
      notifications.show({
        color: 'teal',
        title: 'Email receipts checked',
        message: `${r.checked} emails looked at · ${r.imported} new receipts (${r.matched} matched) · ${r.duplicates} already had · ${r.noTotal} without a total (ignored)`,
      });
    },
    onError: notifyError,
  });
  if (!data) return null;
  const help = provider && data.providers[provider]?.help;
  return (
    <Paper withBorder p="md">
      <Group gap="xs" mb={4}>
        <IconMail size={18} />
        <Title order={5}>Collect receipts from your email</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="xs">
        Flights, hotels, rental cars and online orders email you receipts. The app can sign in to your mailbox, pick out receipt emails from the
        last {f.lookbackDays ?? 120} days, and match them to your card charges.
      </Text>
      <Alert variant="light" color="gray" p="xs" mb="sm" icon={<IconLock size={16} />}>
        <Text size="xs">
          Off until you use it. It connects only to your own email provider, reads only emails whose subject looks like a receipt/order/booking,
          and saves them in your private data folder. Use an <b>app password</b>, not your normal password.
        </Text>
      </Alert>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="xs">
        <Select
          label="Email provider"
          value={provider}
          onChange={(v) => {
            setProvider(v);
            const p = v ? data.providers[v] : undefined;
            if (p) setF({ ...f, host: p.host, port: p.port, mailbox: p.mailbox, secure: true });
          }}
          data={[
            { value: 'gmail', label: 'Gmail / Google Workspace' },
            { value: 'icloud', label: 'iCloud Mail' },
            { value: 'zoho', label: 'Zoho Mail' },
            { value: 'yahoo', label: 'Yahoo Mail' },
            { value: 'other', label: 'Other (IMAP)' },
          ]}
        />
        <TextInput label="Email address" value={f.user ?? ''} onChange={(e) => setF({ ...f, user: e.currentTarget.value })} />
        <PasswordInput
          label="App password"
          placeholder={data.hasSavedPassword ? 'Saved on this computer' : 'Paste the app password'}
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />
        {provider === 'other' && (
          <>
            <TextInput label="IMAP server" placeholder="imap.example.com" value={f.host ?? ''} onChange={(e) => setF({ ...f, host: e.currentTarget.value })} />
            <NumberInput label="Port" value={f.port ?? 993} onChange={(v) => setF({ ...f, port: Number(v) || 993 })} />
          </>
        )}
        <TextInput label="Folder" value={f.mailbox ?? 'INBOX'} onChange={(e) => setF({ ...f, mailbox: e.currentTarget.value })} />
        <NumberInput label="Look back (days)" min={7} max={730} value={f.lookbackDays ?? 120} onChange={(v) => setF({ ...f, lookbackDays: Number(v) || 120 })} />
      </SimpleGrid>
      {help && <Text size="xs" c="dimmed" mt="xs">App password: {help}</Text>}
      <Group mt="sm" justify="space-between" wrap="wrap">
        <Switch
          label="Remember the app password on this computer (stored in your local data file)"
          checked={!!f.rememberPassword}
          onChange={(e) => setF({ ...f, rememberPassword: e.currentTarget.checked })}
        />
        <Group gap="xs">
          <Button variant="default" onClick={() => save.mutate()}>Save settings</Button>
          <Button loading={sync.isPending} disabled={!f.host || !f.user || (!password && !data.hasSavedPassword)} onClick={() => sync.mutate()}>
            Check email now
          </Button>
        </Group>
      </Group>
      <Text size="xs" c="dimmed" mt="xs">
        {data.lastSync ? `Last checked ${shortDate(data.lastSync.slice(0, 10))}. ` : ''}Prefer not to connect your email? Save receipts (PDF or .eml) into{' '}
        <Code>{data.inboxFolder}</Code> and click “Check receipts folder”. Outlook/Hotmail accounts need a sign-in method this app doesn't support yet — forward
        receipts to another address or save them to that folder.
      </Text>
    </Paper>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} fz={24}>{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}
