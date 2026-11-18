import { Alert, Button, Code, Group, Modal, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconArrowBackUp, IconDatabase, IconLock, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { api } from '../api';
import { PageHeader } from '../components/bits';
import { dateTime, shortDate } from '../format';
import { notifyError, useActions, useRefreshAll, useUndo } from '../hooks';

interface Meta {
  version: string;
  dataDir: string;
  dbPath: string;
  schemaVersion: number;
}
interface Backup {
  name: string;
  sizeBytes: number;
  createdAt: string;
}
interface Rate {
  id: number;
  kind: string;
  effectiveFrom: string;
  effectiveTo: string;
  centsPerMile: number;
  note: string | null;
}

export function SettingsPage() {
  const refresh = useRefreshAll();
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/api/meta') });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<Record<string, unknown>>('/api/settings') });
  const backups = useQuery({ queryKey: ['backups'], queryFn: () => api.get<Backup[]>('/api/backups') });
  const rates = useQuery({ queryKey: ['rates'], queryFn: () => api.get<Rate[]>('/api/mileage-rates') });
  const actions = useActions();
  const undo = useUndo();
  const [restore, setRestore] = useState<Backup | null>(null);

  const saveSetting = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/api/settings', body),
    onSuccess: () => {
      void settings.refetch();
      refresh();
    },
    onError: notifyError,
  });
  const backup = useMutation({
    mutationFn: () => api.post<Backup>('/api/backups', { label: 'manual' }),
    onSuccess: () => void backups.refetch(),
    onError: notifyError,
  });
  const doRestore = useMutation({
    mutationFn: (name: string) => api.post('/api/backups/restore', { name }),
    onSuccess: () => {
      setRestore(null);
      void backups.refetch();
      refresh();
    },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader title="Settings & backups" />
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="lg">
        <Stack>
          <Paper withBorder p="md">
            <Group gap="xs" mb="xs">
              <IconLock size={18} />
              <Title order={5}>Privacy</Title>
            </Group>
            <Text size="sm">
              The app runs only on this computer and only accepts connections from this computer. It makes no internet requests: no bank
              linking, no analytics, no cloud. Your data is a single file:
            </Text>
            <Code block mt="xs">
              {meta.data?.dbPath ?? '…'}
            </Code>
            <Text size="xs" c="dimmed" mt="xs">
              It's deliberately not in Documents, which Windows often syncs to OneDrive. Original bank files you import are kept beside it in
              the “imports” folder. Turning on BitLocker / Device Encryption protects it if the computer is lost.
            </Text>
          </Paper>

          <Paper withBorder p="md">
            <Group justify="space-between" mb="xs">
              <Group gap="xs">
                <IconDatabase size={18} />
                <Title order={5}>Backups</Title>
              </Group>
              <Button size="xs" onClick={() => backup.mutate()} loading={backup.isPending}>
                Back up now
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mb="xs">
              Backups are saved in the data folder's “backups” folder. Copy them to a USB drive now and then. A backup is also made automatically
              before every app upgrade and before any restore.
            </Text>
            <Table fz="xs" verticalSpacing={4}>
              <Table.Tbody>
                {(backups.data ?? []).slice(0, 12).map((b) => (
                  <Table.Tr key={b.name}>
                    <Table.Td>{b.name}</Table.Td>
                    <Table.Td>{(b.sizeBytes / 1024).toFixed(0)} KB</Table.Td>
                    <Table.Td>
                      <Button size="compact-xs" variant="subtle" onClick={() => setRestore(b)}>
                        Restore
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {backups.data?.length === 0 && (
                  <Table.Tr>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        No backups yet.
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Paper>

          <Paper withBorder p="md">
            <Title order={5} mb="xs">
              Recent changes (undo)
            </Title>
            <Table fz="xs" verticalSpacing={4}>
              <Table.Tbody>
                {(actions.data ?? []).map((a) => (
                  <Table.Tr key={a.id} style={{ opacity: a.undoneAt ? 0.5 : 1 }}>
                    <Table.Td className="nowrap">{dateTime(a.createdAt)}</Table.Td>
                    <Table.Td>{a.summary}</Table.Td>
                    <Table.Td>
                      {a.undoneAt ? (
                        <Text size="xs" c="dimmed">
                          undone
                        </Text>
                      ) : (
                        <Button size="compact-xs" variant="subtle" leftSection={<IconArrowBackUp size={12} />} onClick={() => undo.mutate(a.id)}>
                          Undo
                        </Button>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Stack>

        <Stack>
          <Paper withBorder p="md">
            <Title order={5} mb="xs">
              Business
            </Title>
            <TextInput
              label="Business name (shown on reports)"
              defaultValue={(settings.data?.business_name as string) ?? ''}
              key={String(settings.data?.business_name)}
              onBlur={(e) => saveSetting.mutate({ business_name: e.currentTarget.value })}
            />
            <Text size="sm" fw={500} mt="md" mb={4}>
              Vehicle expense method
            </Text>
            <SegmentedControl
              value={(settings.data?.mileage_method as string) ?? 'standard'}
              onChange={(v) => saveSetting.mutate({ mileage_method: v })}
              data={[
                { value: 'standard', label: 'Standard mileage rate' },
                { value: 'actual', label: 'Actual expenses' },
              ]}
            />
            <Text size="xs" c="dimmed" mt={4}>
              With the standard rate (most common), gas, repairs and insurance for your own car are not deductible — only miles, parking and tolls.
              The “Vehicle: gas, repairs…” category is then left out of totals.
            </Text>
            <Group grow mt="md">
              <NumberInput
                label="Trip bookings: look back (days)"
                description="Flights/hotels booked before a trip"
                min={0}
                max={365}
                value={(settings.data?.trip_window_before_days as number) ?? 60}
                onChange={(v) => typeof v === 'number' && saveSetting.mutate({ trip_window_before_days: v })}
              />
              <NumberInput
                label="Trip charges: look ahead (days)"
                description="Hotel/rental bills posting after"
                min={0}
                max={60}
                value={(settings.data?.trip_window_after_days as number) ?? 5}
                onChange={(v) => typeof v === 'number' && saveSetting.mutate({ trip_window_after_days: v })}
              />
            </Group>
          </Paper>

          <MileageRates rates={rates.data ?? []} onChange={() => void rates.refetch()} />

          <Text size="xs" c="dimmed">
            App version {meta.data?.version} · data format v{meta.data?.schemaVersion}
          </Text>
        </Stack>
      </SimpleGrid>

      <Modal opened={!!restore} onClose={() => setRestore(null)} title="Restore this backup?">
        <Text size="sm">
          Everything will go back to how it was on <b>{restore && dateTime(restore.createdAt)}</b>. A safety backup of your current data is
          made first, so you can switch back.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setRestore(null)}>
            Cancel
          </Button>
          <Button color="orange" loading={doRestore.isPending} onClick={() => restore && doRestore.mutate(restore.name)}>
            Restore
          </Button>
        </Group>
      </Modal>
    </>
  );
}

function MileageRates({ rates, onChange }: { rates: Rate[]; onChange: () => void }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cents, setCents] = useState<number | string>('');
  const add = useMutation({
    mutationFn: () => api.post('/api/mileage-rates', { effectiveFrom: from, effectiveTo: to, centsPerMile: Number(cents) }),
    onSuccess: () => {
      setFrom('');
      setTo('');
      setCents('');
      onChange();
    },
    onError: notifyError,
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/mileage-rates/${id}`), onSuccess: onChange, onError: notifyError });
  return (
    <Paper withBorder p="md">
      <Title order={5} mb="xs">
        IRS standard mileage rates
      </Title>
      <Alert color="yellow" variant="light" p="xs" mb="xs">
        <Text size="xs">
          Rates can change mid-year. Each drive uses the rate for its own date. Check irs.gov each year (search “standard mileage rates”).
        </Text>
      </Alert>
      <Table fz="xs" verticalSpacing={4}>
        <Table.Tbody>
          {rates.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td className="nowrap">
                {shortDate(r.effectiveFrom)} – {shortDate(r.effectiveTo)}
              </Table.Td>
              <Table.Td ff="monospace">{r.centsPerMile}¢</Table.Td>
              <Table.Td c="dimmed">{r.note}</Table.Td>
              <Table.Td>
                <Button size="compact-xs" variant="subtle" color="gray" onClick={() => del.mutate(r.id)} aria-label="Delete rate">
                  <IconTrash size={12} />
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Group gap="xs" mt="xs" align="flex-end">
        <TextInput size="xs" type="date" label="From" value={from} onChange={(e) => setFrom(e.currentTarget.value)} />
        <TextInput size="xs" type="date" label="To" value={to} onChange={(e) => setTo(e.currentTarget.value)} />
        <NumberInput size="xs" w={100} label="¢ / mile" decimalScale={1} value={cents} onChange={setCents} />
        <Button size="xs" variant="default" onClick={() => add.mutate()} disabled={!from || !to || !cents}>
          Add rate
        </Button>
      </Group>
    </Paper>
  );
}
