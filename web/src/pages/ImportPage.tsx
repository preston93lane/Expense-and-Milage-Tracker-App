import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Collapse,
  Group,
  List,
  Modal,
  Paper,
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
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconArrowBackUp, IconFileUpload, IconInfoCircle, IconLock } from '@tabler/icons-react';
import type { CsvMapping, DateFormat } from '@et/core';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type AccountType, type ImportBatch, type ImportPreview, type ImportResult } from '../api';
import { Money, PageHeader } from '../components/bits';
import { CategorySelect } from '../components/CategorySelect';
import { ACCOUNT_TYPE_LABEL, dateTime, shortDate } from '../format';
import { notifyError, useAccounts, useCategoryMap, useRefreshAll } from '../hooks';

interface PendingFile {
  name: string;
  content: string;
}

const DATE_FORMATS: DateFormat[] = ['MM/DD/YYYY', 'MM/DD/YY', 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYYMMDD', 'MON DD, YYYY', 'DD MON YYYY', 'DD/MM/YYYY', 'DD/MM/YY'];

export function ImportPage() {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [lastResult, setLastResult] = useState<(ImportResult & { fileName: string }) | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    const read = await Promise.all([...list].map(async (f) => ({ name: f.name, content: await f.text() })));
    setFiles((cur) => [...cur, ...read]);
    setLastResult(null);
  };

  return (
    <>
      <PageHeader
        title="Import bank files"
        description="Download each account's statement (CSV, or the Quicken/QuickBooks .QFX/.QBO/.OFX file if your bank offers it) and drop it here. Overlapping date ranges are fine — duplicates are skipped."
      />
      <Paper
        withBorder
        p="xl"
        mb="md"
        ta="center"
        style={{ borderStyle: 'dashed', borderWidth: 2, background: dragging ? 'var(--mantine-color-cyan-light)' : undefined, cursor: 'pointer' }}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
      >
        <IconFileUpload size={36} color="var(--mantine-color-cyan-7)" />
        <Text fw={600} mt="xs">
          Drop bank files here, or click to choose
        </Text>
        <Text size="sm" c="dimmed">
          .csv · .qfx · .qbo · .ofx
        </Text>
        <Group justify="center" gap={6} mt="xs" c="dimmed">
          <IconLock size={14} />
          <Text size="xs">Files are read by the app on this computer only. A private copy is kept in your data folder.</Text>
        </Group>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".csv,.txt,.ofx,.qfx,.qbo,text/csv"
          hidden
          data-testid="file-input"
          onChange={(e) => {
            void addFiles(e.currentTarget.files);
            e.currentTarget.value = '';
          }}
        />
      </Paper>

      {lastResult && <ResultSummary r={lastResult} />}

      {files.length > 0 && (
        <FileImporter
          key={`${files[0].name}-${files.length}`}
          file={files[0]}
          remaining={files.length - 1}
          onDone={(r) => {
            setLastResult({ ...r, fileName: files[0].name });
            setFiles((f) => f.slice(1));
          }}
          onCancel={() => setFiles((f) => f.slice(1))}
        />
      )}

      <ImportHistory />
    </>
  );
}

function ResultSummary({ r }: { r: ImportResult & { fileName: string } }) {
  return (
    <Alert color="teal" mb="md" title={`Imported ${r.fileName}`}>
      <Text size="sm">
        <b>{r.newCount}</b> new transactions
        {r.duplicateCount ? ` · ${r.duplicateCount} duplicates skipped` : ''}
        {r.possibleDuplicatesSkipped ? ` · ${r.possibleDuplicatesSkipped} possible duplicates skipped` : ''}
        {r.errorCount ? ` · ${r.errorCount} rows could not be read` : ''}.
      </Text>
      <Text size="sm">
        {r.autoReviewed} sorted automatically by your rules · {r.suggested} with suggestions · {r.needsReview} need you
        {r.transfersPaired ? ` · ${r.transfersPaired} card payments/transfers matched` : ''}.
      </Text>
      {r.needsReview + r.suggested > 0 && (
        <Button component={Link} to="/review" size="xs" mt="xs">
          Review now
        </Button>
      )}
    </Alert>
  );
}

function FileImporter({
  file,
  remaining,
  onDone,
  onCancel,
}: {
  file: PendingFile;
  remaining: number;
  onDone: (r: ImportResult) => void;
  onCancel: () => void;
}) {
  const accounts = useAccounts();
  const categories = useCategoryMap();
  const refresh = useRefreshAll();
  const [accountId, setAccountId] = useState<number | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [historyMode, setHistoryMode] = useState(false);
  const [categoryMap, setCategoryMap] = useState<Record<string, number | null>>({});
  const [skipPossible, setSkipPossible] = useState(true);
  const [showColumns, setShowColumns] = useState(false);
  const [newAccountOpen, setNewAccountOpen] = useState(false);

  const preview = useQuery({
    queryKey: ['import-preview', file.name, file.content.length, accountId, mapping, historyMode, categoryMap],
    queryFn: () =>
      api.post<ImportPreview>('/api/import/preview', {
        fileName: file.name,
        content: file.content,
        accountId,
        mapping,
        historyMode,
        categoryMap,
      }),
    retry: false,
  });
  const p = preview.data;

  // Adopt the suggested account (OFX account number match) once.
  useEffect(() => {
    if (!accountId && p?.suggestedAccountId) setAccountId(p.suggestedAccountId);
  }, [p?.suggestedAccountId, accountId]);

  const commit = useMutation({
    mutationFn: () =>
      api.post<ImportResult>('/api/import/commit', {
        fileName: file.name,
        content: file.content,
        accountId,
        mapping,
        historyMode,
        categoryMap,
        skipPossibleDuplicates: skipPossible,
      }),
    onSuccess: (r) => {
      refresh();
      onDone(r);
    },
    onError: notifyError,
  });

  const headers = p?.headers ?? (p?.sampleRows[0] ? p.sampleRows[0].map((_, i) => `Column ${i + 1}`) : []);
  const colOptions = headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }));
  const m = mapping ?? p?.mapping ?? null;
  const editMapping = (patch: Partial<CsvMapping>) => m && setMapping({ ...m, ...patch });

  return (
    <Paper withBorder p="md" mb="lg" shadow="xs">
      <Group justify="space-between" mb="sm">
        <div>
          <Title order={4}>{file.name}</Title>
          {remaining > 0 && (
            <Text size="xs" c="dimmed">
              {remaining} more file{remaining === 1 ? '' : 's'} waiting
            </Text>
          )}
        </div>
        <Button variant="subtle" color="gray" onClick={onCancel}>
          Skip this file
        </Button>
      </Group>

      <Group align="flex-end" gap="sm" mb="sm">
        <Select
          label="Which account is this?"
          placeholder="Choose account"
          w={280}
          value={accountId ? String(accountId) : null}
          onChange={(v) => setAccountId(v ? Number(v) : null)}
          data={(accounts.data ?? []).filter((a) => !a.archived).map((a) => ({ value: String(a.id), label: `${a.name} (${ACCOUNT_TYPE_LABEL[a.type]})` }))}
          error={!accountId && p ? 'Required' : undefined}
        />
        <Button variant="default" onClick={() => setNewAccountOpen(true)}>
          + New account
        </Button>
        <Switch
          ml="md"
          checked={historyMode}
          onChange={(e) => setHistoryMode(e.currentTarget.checked)}
          label="This file has my own categories (e.g. a QuickBooks Self-Employed export)"
        />
      </Group>

      {preview.isError && (
        <Alert color="red" icon={<IconAlertTriangle />} mb="sm" title="Couldn't read this file">
          {(preview.error as Error).message}
        </Alert>
      )}
      {p && (
        <Stack gap="sm">
          {p.warnings.map((w) => (
            <Alert key={w} color="yellow" variant="light" icon={<IconInfoCircle size={18} />} p="xs">
              <Text size="sm">{w}</Text>
            </Alert>
          ))}

          <SimpleGrid cols={{ base: 2, sm: 4 }}>
            <Stat label="Rows in file" value={p.counts.total} />
            <Stat label="New" value={p.counts.new} color="teal" />
            <Stat label="Already imported" value={p.counts.duplicates} color="gray" />
            <Stat label="Possible duplicates" value={p.counts.possibleDuplicates} color={p.counts.possibleDuplicates ? 'orange' : 'gray'} />
          </SimpleGrid>
          {p.dateRange && (
            <Text size="sm" c="dimmed">
              {shortDate(p.dateRange.from)} – {shortDate(p.dateRange.to)} · {p.kind === 'ofx' ? 'Quicken/QuickBooks (OFX) file' : 'CSV file'}
            </Text>
          )}
          {p.counts.possibleDuplicates > 0 && (
            <Checkbox
              checked={skipPossible}
              onChange={(e) => setSkipPossible(e.currentTarget.checked)}
              label="Skip possible duplicates (same date, amount and description as something already imported)"
            />
          )}
          {p.errors.length > 0 && (
            <Alert color="orange" variant="light" p="xs" title={`${p.errors.length} row(s) could not be read and will be skipped`}>
              <List size="xs">
                {p.errors.slice(0, 5).map((e) => (
                  <List.Item key={e.row}>
                    Row {e.row}: {e.message}
                  </List.Item>
                ))}
              </List>
            </Alert>
          )}

          {p.kind === 'csv' && m && (
            <>
              <Button variant="subtle" size="xs" w="fit-content" onClick={() => setShowColumns((s) => !s)}>
                {showColumns ? 'Hide' : 'Check'} which columns are used {mapping ? '(edited)' : ''}
              </Button>
              <Collapse in={showColumns}>
                <Paper withBorder p="sm">
                  <Group gap="sm" align="flex-end" wrap="wrap">
                    <Select label="Date" w={180} data={colOptions} value={String(m.dateColumn)} onChange={(v) => v && editMapping({ dateColumn: Number(v) })} />
                    <Select label="Date format" w={160} data={DATE_FORMATS} value={m.dateFormat} onChange={(v) => v && editMapping({ dateFormat: v as DateFormat })} />
                    <Select label="Description" w={200} data={colOptions} value={String(m.descriptionColumn)} onChange={(v) => v && editMapping({ descriptionColumn: Number(v) })} />
                    <SegmentedControl
                      value={m.amountMode}
                      onChange={(v) => editMapping({ amountMode: v as CsvMapping['amountMode'] })}
                      data={[
                        { value: 'single', label: 'One amount column' },
                        { value: 'debit_credit', label: 'Debit + credit columns' },
                      ]}
                    />
                    {m.amountMode === 'single' ? (
                      <Select label="Amount" w={180} data={colOptions} value={m.amountColumn !== undefined ? String(m.amountColumn) : null} onChange={(v) => v && editMapping({ amountColumn: Number(v) })} />
                    ) : (
                      <>
                        <Select label="Debit (money out)" w={180} data={colOptions} value={m.debitColumn !== undefined ? String(m.debitColumn) : null} onChange={(v) => v && editMapping({ debitColumn: Number(v) })} />
                        <Select label="Credit (money in)" w={180} data={colOptions} value={m.creditColumn !== undefined ? String(m.creditColumn) : null} onChange={(v) => v && editMapping({ creditColumn: Number(v) })} />
                      </>
                    )}
                    <Switch
                      checked={m.invertSign}
                      onChange={(e) => editMapping({ invertSign: e.currentTarget.checked })}
                      label="Purchases show as positive numbers (flip signs)"
                    />
                    {mapping && (
                      <Button size="xs" variant="subtle" onClick={() => setMapping(null)}>
                        Reset to automatic
                      </Button>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed" mt="xs">
                    This layout is remembered for this account, so next month is one click.
                  </Text>
                </Paper>
              </Collapse>
            </>
          )}

          {historyMode && p.categoryLabels.length > 0 && (
            <Paper withBorder p="sm">
              <Text fw={600} size="sm" mb="xs">
                Match the file's categories to yours
              </Text>
              <Table fz="sm">
                <Table.Tbody>
                  {p.categoryLabels.map((l) => (
                    <Table.Tr key={l.label}>
                      <Table.Td w={240}>
                        {l.label} <Text span c="dimmed" size="xs">({l.count})</Text>
                      </Table.Td>
                      <Table.Td>
                        <CategorySelect
                          size="xs"
                          w={300}
                          placeholder={/^personal$/i.test(l.label) ? 'Personal' : 'Not business / skip'}
                          value={l.categoryId}
                          onChange={(id) => setCategoryMap((cm) => ({ ...cm, [l.label]: id }))}
                        />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          <Table.ScrollContainer minWidth={760}>
            <Table fz="xs" striped verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>Description</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th>What will happen</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {p.rows.slice(0, 60).map((r, i) => (
                  <Table.Tr key={i} style={{ opacity: r.duplicate === 'exact' ? 0.45 : 1 }}>
                    <Table.Td className="nowrap">{r.date}</Table.Td>
                    <Table.Td>
                      <Text size="xs" fw={500}>
                        {r.merchant}
                      </Text>
                      <Text size="xs" c="dimmed" lineClamp={1}>
                        {r.description}
                      </Text>
                    </Table.Td>
                    <Table.Td ta="right">
                      <Money cents={r.amountCents} size="xs" />
                    </Table.Td>
                    <Table.Td>
                      {r.duplicate === 'exact' ? (
                        <Badge color="gray" variant="light">already imported</Badge>
                      ) : r.duplicate === 'possible' ? (
                        <Badge color="orange" variant="light">possible duplicate</Badge>
                      ) : r.status === 'reviewed' ? (
                        <Badge color="teal" variant="light">
                          {r.classification}
                          {r.categoryId ? ` · ${categories.get(r.categoryId)?.name}` : ''}
                        </Badge>
                      ) : r.status === 'suggested' ? (
                        <Badge color="cyan" variant="outline">
                          suggest {r.classification}
                          {r.categoryId ? ` · ${categories.get(r.categoryId)?.name}` : ''}
                        </Badge>
                      ) : (
                        <Group gap={4} wrap="nowrap">
                          <Badge color="orange" variant="dot">needs review</Badge>
                          {r.categoryId && (
                            <Text size="xs" c="dimmed" lineClamp={1}>
                              if business: {categories.get(r.categoryId)?.name}
                            </Text>
                          )}
                        </Group>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          {p.rows.length > 60 && (
            <Text size="xs" c="dimmed">
              …and {p.rows.length - 60} more rows
            </Text>
          )}
          <Group justify="flex-end">
            <Button
              size="md"
              disabled={!accountId || p.counts.new + (skipPossible ? 0 : p.counts.possibleDuplicates) === 0}
              loading={commit.isPending}
              onClick={() => commit.mutate()}
            >
              Import {p.counts.new + (skipPossible ? 0 : p.counts.possibleDuplicates)} transactions
            </Button>
          </Group>
        </Stack>
      )}
      <NewAccountModal
        opened={newAccountOpen}
        onClose={() => setNewAccountOpen(false)}
        defaults={{
          type: (p?.ofx?.accountType as AccountType) ?? undefined,
          last4: p?.ofx?.accountId?.replace(/\D/g, '').slice(-4),
        }}
        onCreated={(id) => {
          setAccountId(id);
          setNewAccountOpen(false);
        }}
      />
    </Paper>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <Paper withBorder p="xs">
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={700} fz="lg" c={color}>
        {value}
      </Text>
    </Paper>
  );
}

export function NewAccountModal({
  opened,
  onClose,
  onCreated,
  defaults,
}: {
  opened: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
  defaults?: { type?: AccountType; last4?: string };
}) {
  const refresh = useRefreshAll();
  const [name, setName] = useState('');
  const [institution, setInstitution] = useState('');
  const [type, setType] = useState<AccountType>(defaults?.type ?? 'checking');
  const [last4, setLast4] = useState(defaults?.last4 ?? '');
  useEffect(() => {
    if (opened) {
      setType(defaults?.type && defaults.type !== ('other' as AccountType) ? defaults.type : 'checking');
      setLast4(defaults?.last4 ?? '');
    }
  }, [opened, defaults?.type, defaults?.last4]);
  const create = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/accounts', { name, institution, type, last4 }),
    onSuccess: (a) => {
      refresh();
      setName('');
      setInstitution('');
      onCreated(a.id);
    },
    onError: notifyError,
  });
  return (
    <Modal opened={opened} onClose={onClose} title="New account">
      <Stack>
        <TextInput label="Name" placeholder="e.g. Chase Sapphire, Business Checking" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <TextInput label="Bank (optional)" value={institution} onChange={(e) => setInstitution(e.currentTarget.value)} />
        <Select
          label="Type"
          value={type}
          onChange={(v) => v && setType(v as AccountType)}
          data={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <TextInput label="Last 4 digits (optional)" description="Helps match QFX/OFX files to this account" value={last4} maxLength={4} onChange={(e) => setLast4(e.currentTarget.value)} />
        <Button onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>
          Create account
        </Button>
      </Stack>
    </Modal>
  );
}

function ImportHistory() {
  const refresh = useRefreshAll();
  const { data } = useQuery({ queryKey: ['batches'], queryFn: () => api.get<ImportBatch[]>('/api/import/batches') });
  const [confirm, setConfirm] = useState<ImportBatch | null>(null);
  const undo = useMutation({
    mutationFn: (id: number) => api.del<{ removed: number }>(`/api/import/batches/${id}`),
    onSuccess: () => {
      refresh();
      setConfirm(null);
    },
    onError: notifyError,
  });
  if (!data?.length) return null;
  return (
    <>
      <Title order={4} mt="xl" mb="xs">
        Import history
      </Title>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={700}>
          <Table fz="sm" verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>When</Table.Th>
                <Table.Th>File</Table.Th>
                <Table.Th>Account</Table.Th>
                <Table.Th>Dates</Table.Th>
                <Table.Th ta="right">New</Table.Th>
                <Table.Th ta="right">Skipped</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.map((b) => (
                <Table.Tr key={b.id}>
                  <Table.Td className="nowrap">{dateTime(b.createdAt)}</Table.Td>
                  <Table.Td>
                    {b.fileName}
                    {b.historyMode && (
                      <Badge ml={6} size="xs" variant="light">
                        history
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td>{b.accountName}</Table.Td>
                  <Table.Td className="nowrap">{b.dateFrom ? `${shortDate(b.dateFrom)} – ${shortDate(b.dateTo!)}` : '—'}</Table.Td>
                  <Table.Td ta="right">{b.newCount}</Table.Td>
                  <Table.Td ta="right">{b.duplicateCount}</Table.Td>
                  <Table.Td ta="right">
                    {b.currentCount > 0 && (
                      <Button size="compact-xs" variant="subtle" color="red" leftSection={<IconArrowBackUp size={14} />} onClick={() => setConfirm(b)}>
                        Undo import
                      </Button>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <Modal opened={!!confirm} onClose={() => setConfirm(null)} title="Undo this import?">
        <Text size="sm">
          This removes the {confirm?.currentCount} transactions that came from <b>{confirm?.fileName}</b>, including any categories you set on them.
          You can import the file again afterwards.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirm(null)}>
            Cancel
          </Button>
          <Button color="red" loading={undo.isPending} onClick={() => confirm && undo.mutate(confirm.id)}>
            Remove {confirm?.currentCount} transactions
          </Button>
        </Group>
      </Modal>
    </>
  );
}
