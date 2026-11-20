import {
  ActionIcon,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconFileInvoice, IconPencil, IconPlayerPlay, IconPlayerStop, IconPlus, IconSettings, IconTrash } from '@tabler/icons-react';
import { ACTIVITIES, ACTIVITY_LABEL, formatMinutes, type Activity } from '@et/core';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Trip } from '../api';
import { PageHeader } from '../components/bits';
import { HoursChart, ShareBars } from '../components/HoursChart';
import { ClientSelect, ProjectSelect } from '../components/PartySelects';
import { money, shortDate, toIso } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

export interface TimeEntry {
  id: number;
  date: string;
  startedAt: string | null;
  endedAt: string | null;
  running: boolean;
  minutes: number;
  clientId: number | null;
  clientName: string | null;
  projectId: number | null;
  projectName: string | null;
  tripId: number | null;
  tripName: string | null;
  activity: Activity;
  description: string | null;
  billable: boolean;
  ownRateCents: number | null;
  rateCents: number | null;
  valueCents: number;
  invoiceId: number | null;
  invoiceNumber: string | null;
}

interface Summary {
  year: number;
  settings: { targetHourlyCents: number | null; defaultRateCents: number | null };
  todayMinutes: number;
  weekMinutes: number;
  totalMinutes: number;
  billableMinutes: number;
  unbilledMinutes: number;
  unbilledValueCents: number;
  netProfitCents: number;
  effectiveHourlyCents: number | null;
  byActivity: { key: string; label: string; minutes: number; pct: number }[];
  byClient: { key: string; label: string; minutes: number; pct: number }[];
  weekly: { weekStart: string; billableMinutes: number; otherMinutes: number }[];
  unbilledByClient: { clientId: number; clientName: string; minutes: number; valueCents: number; missingRate: boolean }[];
}

const activityData = ACTIVITIES.map((a) => ({ value: a, label: ACTIVITY_LABEL[a] }));

export function TimePage() {
  const year = new Date().getFullYear();
  const refresh = useRefreshAll();
  const navigate = useNavigate();
  const list = useQuery({ queryKey: ['time', 'list'], queryFn: () => api.get<{ entries: TimeEntry[]; running: TimeEntry | null }>('/api/time') });
  const summary = useQuery({ queryKey: ['time', 'summary', year], queryFn: () => api.get<Summary>(`/api/time/summary?year=${year}`) });
  const [editing, setEditing] = useState<Partial<TimeEntry> | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const done = () => {
    refresh();
    void list.refetch();
    void summary.refetch();
  };
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/time/${id}`), onSuccess: done, onError: notifyError });
  const bill = useMutation({
    mutationFn: (clientId: number) => api.post<{ invoiceId: number; entries: number }>('/api/time/invoice', { clientId }),
    onSuccess: (r) => {
      done();
      notifications.show({ color: 'teal', message: `Draft invoice created from ${r.entries} time entr${r.entries === 1 ? 'y' : 'ies'}` });
      navigate(`/invoices/${r.invoiceId}`);
    },
    onError: notifyError,
  });

  const s = summary.data;
  const entries = list.data?.entries ?? [];
  const target = s?.settings.targetHourlyCents ?? null;

  return (
    <>
      <PageHeader
        title="Time tracking"
        description="Where your hours go, what’s still unbilled, and what you really earn per hour once costs are counted."
        right={
          <Group>
            <Button variant="default" leftSection={<IconSettings size={16} />} onClick={() => setSettingsOpen(true)}>
              Rates
            </Button>
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ date: toIso(new Date()), activity: 'client_work', billable: true })}>
              Add time
            </Button>
          </Group>
        }
      />
      <Stack>
        <Timer running={list.data?.running ?? null} onChange={done} />

        {s && (
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Kpi label="Today" value={formatMinutes(s.todayMinutes)} />
            <Kpi label="This week" value={formatMinutes(s.weekMinutes)} />
            <Kpi
              label={`Tracked in ${year}`}
              value={formatMinutes(s.totalMinutes)}
              hint={s.totalMinutes ? `${Math.round((s.billableMinutes / s.totalMinutes) * 100)}% billable` : 'Start a timer or add time'}
            />
            <Kpi
              label="What you earn per hour"
              value={s.effectiveHourlyCents !== null ? `${money(s.effectiveHourlyCents)}/h` : '—'}
              hint={
                s.effectiveHourlyCents !== null
                  ? `Profit ${money(s.netProfitCents)} ÷ hours tracked${target ? ` · target ${money(target)}/h` : ''}`
                  : 'Profit ÷ hours tracked'
              }
              color={target && s.effectiveHourlyCents !== null ? (s.effectiveHourlyCents >= target ? 'teal.8' : 'orange.8') : undefined}
            />
          </SimpleGrid>
        )}

        {s && s.unbilledByClient.length > 0 && (
          <Paper withBorder p="md">
            <Title order={5} mb="xs">
              Unbilled time · {money(s.unbilledValueCents)}
            </Title>
            {s.unbilledByClient.map((u) => (
              <Group key={u.clientId} justify="space-between" py={2}>
                <Text size="sm">
                  {u.clientName} · {formatMinutes(u.minutes)}
                  {u.missingRate ? ' · no hourly rate set' : ` · ${money(u.valueCents)}`}
                </Text>
                <Button size="xs" variant="light" leftSection={<IconFileInvoice size={14} />} loading={bill.isPending && bill.variables === u.clientId} onClick={() => bill.mutate(u.clientId)}>
                  Create invoice
                </Button>
              </Group>
            ))}
          </Paper>
        )}

        {s && s.totalMinutes > 0 && (
          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Paper withBorder p="md">
              <Title order={5} mb="xs">
                Hours per week
              </Title>
              <HoursChart
                ariaLabel="Hours tracked per week, billable and other"
                labels={s.weekly.map((w) => shortDate(w.weekStart).replace(/, \d{4}$/, ''))}
                series={[
                  { name: 'Billable', color: 'var(--mantine-color-blue-7)', values: s.weekly.map((w) => w.billableMinutes) },
                  { name: 'Other', color: 'var(--mantine-color-orange-7)', values: s.weekly.map((w) => w.otherMinutes) },
                ]}
              />
            </Paper>
            <Paper withBorder p="md">
              <Title order={5} mb="xs">
                Where your time goes in {year}
              </Title>
              <ShareBars rows={s.byActivity} />
              <Text size="xs" c="dimmed" mt="sm" mb={4} fw={600} tt="uppercase">
                By client
              </Text>
              <ShareBars rows={s.byClient} />
            </Paper>
          </SimpleGrid>
        )}

        <Paper withBorder p="md">
          <Title order={5} mb="xs">
            Time entries
          </Title>
          {entries.length === 0 ? (
            <Text size="sm" c="dimmed">
              Nothing tracked yet. Start the timer above when you begin work, or add time afterwards.
            </Text>
          ) : (
            <Table.ScrollContainer minWidth={760}>
              <Table fz="sm" verticalSpacing={4} highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Date</Table.Th>
                    <Table.Th>What</Table.Th>
                    <Table.Th>For</Table.Th>
                    <Table.Th ta="right">Time</Table.Th>
                    <Table.Th ta="right">Value</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {entries.map((e) => (
                    <Table.Tr key={e.id}>
                      <Table.Td w={120}>{shortDate(e.date)}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{e.description ?? ACTIVITY_LABEL[e.activity]}</Text>
                        <Text size="xs" c="dimmed">
                          {ACTIVITY_LABEL[e.activity]}
                          {e.billable ? '' : ' · not billable'}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{[e.clientName, e.projectName].filter(Boolean).join(' · ') || '—'}</Text>
                        {e.tripName && (
                          <Text size="xs" c="dimmed">
                            Trip: {e.tripName}
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {e.running ? (
                          <Badge color="red" variant="light">
                            running
                          </Badge>
                        ) : (
                          formatMinutes(e.minutes)
                        )}
                      </Table.Td>
                      <Table.Td ta="right">
                        <Text size="sm" ff="monospace">
                          {e.valueCents ? money(e.valueCents) : '—'}
                        </Text>
                        {e.invoiceNumber && (
                          <Badge size="xs" variant="light" color="teal">
                            billed {e.invoiceNumber}
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td w={70}>
                        <Group gap={2} wrap="nowrap">
                          <Tooltip label="Edit">
                            <ActionIcon variant="subtle" aria-label="Edit time entry" onClick={() => setEditing(e)} disabled={e.running}>
                              <IconPencil size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label="Delete">
                            <ActionIcon variant="subtle" color="red" aria-label="Delete time entry" onClick={() => window.confirm('Delete this time entry?') && del.mutate(e.id)}>
                              <IconTrash size={16} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
        </Paper>
      </Stack>
      {editing && (
        <EntryModal
          initial={editing}
          onClose={() => {
            setEditing(null);
            done();
          }}
        />
      )}
      {settingsOpen && s && (
        <RatesModal
          initial={s.settings}
          onClose={() => {
            setSettingsOpen(false);
            done();
          }}
        />
      )}
    </>
  );
}

function Kpi({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fw={700} fz={24} ff="monospace" c={color}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </Paper>
  );
}

function elapsed(startIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(startIso).getTime()) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function Timer({ running, onChange }: { running: TimeEntry | null; onChange: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [clientId, setClientId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [activity, setActivity] = useState<Activity>('client_work');
  const [description, setDescription] = useState('');
  const [billable, setBillable] = useState(true);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  const start = useMutation({
    mutationFn: () => api.post('/api/time/start', { clientId, projectId, activity, description, billable }),
    onSuccess: () => {
      setNow(Date.now());
      onChange();
    },
    onError: notifyError,
  });
  const stop = useMutation({
    mutationFn: () => api.post<TimeEntry & { discarded: boolean }>('/api/time/stop'),
    onSuccess: (e) => {
      notifications.show(
        e.discarded
          ? { color: 'gray', message: 'Stopped in under a minute — nothing logged.' }
          : { color: 'teal', message: `Logged ${formatMinutes(e.minutes)}${e.clientName ? ` for ${e.clientName}` : ''}` },
      );
      setDescription('');
      onChange();
    },
    onError: notifyError,
  });

  if (running?.startedAt) {
    return (
      <Paper withBorder p="md" bg="var(--mantine-color-red-0)">
        <Group justify="space-between">
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
              Timer running
            </Text>
            <Text fw={600}>
              {running.description ?? ACTIVITY_LABEL[running.activity]}
              {running.clientName ? ` · ${running.clientName}` : ''}
              {running.projectName ? ` · ${running.projectName}` : ''}
            </Text>
          </div>
          <Group>
            <Text fz={28} fw={700} ff="monospace" aria-live="off">
              {elapsed(running.startedAt, now)}
            </Text>
            <Button color="red" leftSection={<IconPlayerStop size={16} />} loading={stop.isPending} onClick={() => stop.mutate()}>
              Stop
            </Button>
          </Group>
        </Group>
      </Paper>
    );
  }
  return (
    <Paper withBorder p="md">
      <Group align="flex-end" wrap="wrap">
        <TextInput label="What are you working on?" placeholder="e.g. Editing wedding video" value={description} onChange={(e) => setDescription(e.currentTarget.value)} style={{ flex: 2, minWidth: 220 }} />
        <ClientSelect label="Client" value={clientId} onChange={(v) => { setClientId(v); setProjectId(null); }} clearable style={{ flex: 1, minWidth: 160 }} />
        <ProjectSelect label="Project" clientId={clientId} value={projectId} onChange={setProjectId} clearable style={{ flex: 1, minWidth: 150 }} />
        <Select label="Activity" data={activityData} value={activity} onChange={(v) => setActivity((v ?? 'client_work') as Activity)} allowDeselect={false} w={180} />
        <Switch label="Billable" checked={billable} onChange={(e) => setBillable(e.currentTarget.checked)} mb={8} />
        <Button leftSection={<IconPlayerPlay size={16} />} loading={start.isPending} onClick={() => start.mutate()}>
          Start timer
        </Button>
      </Group>
    </Paper>
  );
}

function EntryModal({ initial, onClose }: { initial: Partial<TimeEntry>; onClose: () => void }) {
  const [e, setE] = useState<Partial<TimeEntry>>(initial);
  const [hours, setHours] = useState<number | string>(initial.minutes ? Math.round((initial.minutes / 60) * 100) / 100 : '');
  const set = (p: Partial<TimeEntry>) => setE((x) => ({ ...x, ...p }));
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<Trip[]>('/api/trips') });
  const save = useMutation({
    mutationFn: () => {
      const body = {
        date: e.date,
        hours: Number(hours),
        clientId: e.clientId ?? null,
        projectId: e.projectId ?? null,
        tripId: e.tripId ?? null,
        activity: e.activity,
        description: e.description ?? null,
        billable: e.billable ?? true,
        rateCents: e.ownRateCents ?? null,
      };
      return e.id ? api.patch(`/api/time/${e.id}`, body) : api.post('/api/time', body);
    },
    onSuccess: onClose,
    onError: notifyError,
  });
  return (
    <Modal opened onClose={onClose} title={e.id ? 'Edit time' : 'Add time'}>
      <Stack gap="sm">
        <Group grow>
          <TextInput label="Date" type="date" value={e.date ?? ''} onChange={(x) => set({ date: x.currentTarget.value })} />
          <NumberInput label="Hours" description="e.g. 1.5 = 1h 30m" min={0} max={24} decimalScale={2} value={hours} onChange={setHours} />
        </Group>
        <TextInput label="What did you do?" value={e.description ?? ''} onChange={(x) => set({ description: x.currentTarget.value })} />
        <Select label="Activity" data={activityData} value={e.activity ?? 'client_work'} onChange={(v) => set({ activity: (v ?? 'client_work') as Activity })} allowDeselect={false} />
        <Group grow>
          <ClientSelect label="Client" clearable value={e.clientId ?? null} onChange={(v) => set({ clientId: v, projectId: null })} />
          <ProjectSelect label="Project" clearable clientId={e.clientId ?? null} value={e.projectId ?? null} onChange={(v) => set({ projectId: v })} />
        </Group>
        <Select
          label="Business trip"
          clearable
          placeholder="Not on a trip"
          data={(trips.data ?? []).map((t) => ({ value: String(t.id), label: `${t.name} (${shortDate(t.startDate)})` }))}
          value={e.tripId ? String(e.tripId) : null}
          onChange={(v) => set({ tripId: v ? Number(v) : null })}
        />
        <Group grow align="flex-end">
          <Switch label="Billable" checked={e.billable ?? true} onChange={(x) => set({ billable: x.currentTarget.checked })} mb={8} />
          <NumberInput
            label="Rate for this entry"
            description="Leave empty to use the client’s rate"
            prefix="$"
            min={0}
            decimalScale={2}
            disabled={!(e.billable ?? true)}
            value={e.ownRateCents != null ? e.ownRateCents / 100 : ''}
            onChange={(v) => set({ ownRateCents: v === '' ? null : Math.round(Number(v) * 100) })}
          />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!e.date || !Number(hours)}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function RatesModal({ initial, onClose }: { initial: Summary['settings']; onClose: () => void }) {
  const [def, setDef] = useState<number | string>(initial.defaultRateCents != null ? initial.defaultRateCents / 100 : '');
  const [target, setTarget] = useState<number | string>(initial.targetHourlyCents != null ? initial.targetHourlyCents / 100 : '');
  const save = useMutation({
    mutationFn: () =>
      api.put('/api/time/settings', {
        defaultRateCents: def === '' ? null : Math.round(Number(def) * 100),
        targetHourlyCents: target === '' ? null : Math.round(Number(target) * 100),
      }),
    onSuccess: onClose,
    onError: notifyError,
  });
  return (
    <Modal opened onClose={onClose} title="Rates">
      <Stack>
        <NumberInput label="Default billing rate per hour" description="Used when a client has no rate of their own" prefix="$" min={0} decimalScale={2} value={def} onChange={setDef} />
        <NumberInput
          label="Target: what you want to earn per hour"
          description="After costs. Clients and projects below this are flagged on the Profitability page."
          prefix="$"
          min={0}
          decimalScale={2}
          value={target}
          onChange={setTarget}
        />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
