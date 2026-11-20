import { Alert, Badge, Button, Group, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconArrowUpRight, IconCopy, IconDownload } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { api, type SubscriptionSeries, type SubscriptionsResponse } from '../api';
import { PageHeader } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useCategoryMap } from '../hooks';

const APPROACH: Record<string, [string, string]> = {
  already_replaced: ['Replaced by this app', 'teal'],
  self_built_app: ['Self-built app', 'grape'],
  agent_workflow: ['Agent workflow', 'cyan'],
  free_alternative: ['Free alternative', 'blue'],
  consolidate: ['Consolidate', 'yellow'],
  keep: ['Keep', 'gray'],
  personal: ['Personal', 'gray'],
};

const FREQ: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export function SubscriptionsPage() {
  const { data, refetch } = useQuery({ queryKey: ['subscriptions'], queryFn: () => api.get<SubscriptionsResponse>('/api/subscriptions') });
  const categories = useCategoryMap();
  const [showHidden, setShowHidden] = useState(false);
  const savePref = useMutation({
    mutationFn: (b: { seriesKey: string; status: string | null; note?: string | null }) => api.put('/api/subscriptions/prefs', b),
    onSuccess: () => void refetch(),
    onError: notifyError,
  });
  const copy = useMutation({
    mutationFn: () => api.get<{ markdown: string }>('/api/subscriptions/export-text'),
    onSuccess: async (r) => {
      try {
        await navigator.clipboard.writeText(r.markdown);
        notifications.show({ color: 'teal', message: 'Copied. Paste it into a chat with Claude to talk through what to replace.' });
      } catch {
        notifications.show({ color: 'orange', message: 'Could not copy automatically — use Download instead.' });
      }
    },
    onError: notifyError,
  });

  const rows = (data?.series ?? []).filter((s) => showHidden || (s.pref !== 'cancelled' && s.pref !== 'ignore' && s.status !== 'stopped'));
  const byApproach = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of (data?.series ?? []).filter((x) => x.pref !== 'cancelled' && x.pref !== 'ignore' && x.status !== 'stopped')) {
      m.set(s.idea.approach, (m.get(s.idea.approach) ?? 0) + s.yearlyCents);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <>
      <PageHeader
        title="Subscriptions & recurring bills"
        description="Found automatically from your bank files: same merchant, regular schedule, similar amount. Mark what to keep, replace or cancel — cancelled ones drop out of your cash-flow forecast."
        right={
          <Group>
            <Button variant="default" leftSection={<IconCopy size={16} />} loading={copy.isPending} onClick={() => copy.mutate()}>
              Copy list to discuss
            </Button>
            <Button variant="default" component="a" href="/api/subscriptions/export.md" leftSection={<IconDownload size={16} />}>
              Download
            </Button>
          </Group>
        }
      />
      {data && (
        <Stack>
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Kpi label="Per month" value={money(data.totals.monthlyCents)} />
            <Kpi label="Per year" value={money(data.totals.yearlyCents)} hint={`${money(data.totals.businessYearlyCents)} business · ${money(data.totals.personalYearlyCents)} personal/undecided`} />
            <Kpi label="Marked to replace" value={money(data.totals.replaceYearlyCents)} hint="per year you could save" />
            <Kpi label="Price increases" value={String(data.totals.priceIncreases)} hint={data.totals.cancelledYearlyCents ? `${money(data.totals.cancelledYearlyCents)}/yr already cancelled` : undefined} />
          </SimpleGrid>

          <Paper withBorder p="md">
            <Title order={5}>Could an agent workflow or a self-built app do it?</Title>
            <Text size="sm" c="dimmed" mb="sm">
              Like this tracker replacing QuickBooks. Each subscription gets a first idea below; “Copy list to discuss” gives you a
              clean table (service names and amounts only — no account details) to go through with Claude.
            </Text>
            <Group gap="xs">
              {byApproach.map(([a, cents]) => (
                <Badge key={a} color={APPROACH[a]?.[1] ?? 'gray'} variant="light" size="lg" tt="none">
                  {APPROACH[a]?.[0] ?? a}: {money(cents)}/yr
                </Badge>
              ))}
            </Group>
          </Paper>

          <Group justify="flex-end">
            <Switch label="Show cancelled, ignored and stopped" checked={showHidden} onChange={(e) => setShowHidden(e.currentTarget.checked)} />
          </Group>
          <Paper withBorder>
            <Table.ScrollContainer minWidth={1100}>
              <Table fz="sm" verticalSpacing="xs">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Service</Table.Th>
                    <Table.Th ta="right">Amount</Table.Th>
                    <Table.Th ta="right">Per year</Table.Th>
                    <Table.Th>Next charge</Table.Th>
                    <Table.Th>Idea</Table.Th>
                    <Table.Th w={150}>Your plan</Table.Th>
                    <Table.Th w={200}>Note</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.map((s) => (
                    <SubRow key={s.seriesKey} s={s} categoryName={s.categoryId ? categories.get(s.categoryId)?.name : undefined} onPref={(status, note) => savePref.mutate({ seriesKey: s.seriesKey, status, note })} />
                  ))}
                  {rows.length === 0 && (
                    <Table.Tr>
                      <Table.Td colSpan={7}>
                        <Text c="dimmed" ta="center" py="lg" size="sm">
                          Nothing recurring found yet. Import 2–3 months of statements and they'll show up.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>

          {data.recurringIncome.length > 0 && (
            <Paper withBorder p="md">
              <Title order={5} mb="xs">Recurring income</Title>
              <Table fz="sm">
                <Table.Tbody>
                  {data.recurringIncome.map((s) => (
                    <Table.Tr key={s.seriesKey}>
                      <Table.Td>{s.merchant}</Table.Td>
                      <Table.Td>{FREQ[s.frequency]}</Table.Td>
                      <Table.Td ta="right" ff="monospace">{money(s.amountCents)}</Table.Td>
                      <Table.Td>next ~{shortDate(s.nextDate)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed" mt="xs">
                Set these up as retainers on the client's page to track whether each payment actually arrived.
              </Text>
            </Paper>
          )}
          <Alert variant="light" color="gray">
            Detection needs at least 2 charges a month apart (or 3+ for weekly/biweekly). Variable bills like your phone or utilities show
            as “bill”.
          </Alert>
        </Stack>
      )}
    </>
  );
}

function SubRow({ s, categoryName, onPref }: { s: SubscriptionSeries; categoryName?: string; onPref: (status: string | null, note?: string | null) => void }) {
  const [note, setNote] = useState(s.note ?? '');
  const [label, color] = APPROACH[s.idea.approach] ?? [s.idea.approach, 'gray'];
  const up = s.priceChange && s.priceChange.toCents > s.priceChange.fromCents;
  return (
    <Table.Tr style={{ opacity: s.pref === 'cancelled' || s.pref === 'ignore' || s.status === 'stopped' ? 0.5 : 1 }}>
      <Table.Td>
        <Text size="sm" fw={500}>
          {s.merchant}{' '}
          {s.kind === 'bill' && <Badge size="xs" variant="outline" color="gray">bill</Badge>}{' '}
          {s.status !== 'active' && <Badge size="xs" color={s.status === 'stopped' ? 'gray' : 'orange'} variant="light">{s.status === 'stopped' ? 'stopped?' : 'overdue'}</Badge>}
        </Text>
        <Text size="xs" c="dimmed">
          {FREQ[s.frequency]} · {s.occurrences} charges since {shortDate(s.firstDate)} · {s.classification}
          {categoryName ? ` · ${categoryName}` : ''}
        </Text>
      </Table.Td>
      <Table.Td ta="right" ff="monospace">
        {money(s.amountCents)}
        {up && (
          <Tooltip label={`Went up from ${money(s.priceChange!.fromCents)} on ${shortDate(s.priceChange!.date)}`}>
            <Badge ml={4} size="xs" color="red" variant="light" leftSection={<IconArrowUpRight size={10} />}>
              price up
            </Badge>
          </Tooltip>
        )}
      </Table.Td>
      <Table.Td ta="right" ff="monospace">{money(s.yearlyCents)}</Table.Td>
      <Table.Td>{shortDate(s.nextDate)}</Table.Td>
      <Table.Td maw={340}>
        <Badge color={color} variant="light" tt="none" mb={2}>{label}</Badge>
        <Text size="xs" c="dimmed">{s.idea.idea}</Text>
      </Table.Td>
      <Table.Td>
        <Select
          size="xs"
          placeholder="Decide…"
          clearable
          value={s.pref}
          onChange={(v) => onPref(v, note)}
          data={[
            { value: 'keep', label: 'Keep' },
            { value: 'replace', label: 'Replace' },
            { value: 'cancelled', label: 'Cancelled' },
            { value: 'ignore', label: 'Not a subscription' },
          ]}
        />
      </Table.Td>
      <Table.Td>
        <TextInput size="xs" placeholder="e.g. switch to free tier" value={note} onChange={(e) => setNote(e.currentTarget.value)} onBlur={() => note !== (s.note ?? '') && onPref(s.pref ?? 'keep', note)} />
      </Table.Td>
    </Table.Tr>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} fz={24} ff="monospace">{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}
