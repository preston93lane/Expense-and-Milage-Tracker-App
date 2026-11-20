import { ActionIcon, Alert, Badge, Button, Group, NumberInput, Paper, SegmentedControl, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { api, type CashFlowResponse } from '../api';
import { BalanceChart } from '../components/BalanceChart';
import { PageHeader } from '../components/bits';
import { ACCOUNT_TYPE_LABEL, money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

const KIND_LABEL: Record<string, [string, string]> = {
  subscription: ['Subscription', 'gray'],
  bill: ['Bill', 'gray'],
  recurring_income: ['Recurring income', 'teal'],
  retainer: ['Retainer', 'teal'],
  invoice: ['Invoice due', 'teal'],
  tax: ['Estimated tax', 'orange'],
  planned: ['Planned', 'grape'],
  typical_spending: ['Typical spending', 'gray'],
};

export function CashFlowPage() {
  const [days, setDays] = useState('90');
  const [typical, setTypical] = useState(true);
  const [cards, setCards] = useState(true);
  const { data, refetch } = useQuery({
    queryKey: ['cashflow', days, typical, cards],
    queryFn: () => api.get<CashFlowResponse>(`/api/cashflow?days=${days}&typical=${typical ? 1 : 0}&cards=${cards ? 1 : 0}`),
  });

  return (
    <>
      <PageHeader
        title="Cash flow"
        description="Where your cash is heading: today's balances plus expected client payments, minus subscriptions, bills, planned purchases, estimated taxes and your typical everyday spending."
        right={
          <SegmentedControl value={days} onChange={setDays} data={[{ value: '30', label: '30 days' }, { value: '60', label: '60' }, { value: '90', label: '90' }, { value: '180', label: '180' }]} />
        }
      />
      {data && (
        <Stack>
          {data.warnings.map((w) => (
            <Alert key={w} color={w.startsWith('Cash is projected') ? 'red' : 'yellow'} variant="light" icon={<IconAlertTriangle size={18} />} p="xs">
              <Text size="sm">{w}</Text>
            </Alert>
          ))}
          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Kpi label="Cash now" value={money(data.cashCents)} hint="Checking, savings, cash" />
            <Kpi label="Card balances" value={money(data.cardCents)} hint={cards ? 'Counted as owed' : 'Not counted'} />
            <Kpi label={`In ${data.days} days`} value={money(data.endCents)} color={data.endCents < 0 ? 'red' : undefined} />
            <Kpi label="Lowest point" value={money(data.lowest.balanceCents)} hint={shortDate(data.lowest.date)} color={data.lowest.balanceCents < 0 ? 'red' : undefined} />
          </SimpleGrid>
          <Paper withBorder p="md">
            <Group justify="space-between" mb="xs" wrap="wrap">
              <Text fw={600}>Projected balance</Text>
              <Group gap="md">
                <Switch size="xs" label={`Include typical spending (${money(data.weeklyTypicalCents)}/week)`} checked={typical} onChange={(e) => setTypical(e.currentTarget.checked)} />
                <Switch size="xs" label="Subtract card balances" checked={cards} onChange={(e) => setCards(e.currentTarget.checked)} />
              </Group>
            </Group>
            <BalanceChart points={data.weeks.map((w) => ({ date: w.weekStart, balanceCents: w.balanceCents, inCents: w.inCents, outCents: w.outCents }))} />
          </Paper>

          <Group align="flex-start" grow wrap="wrap">
            <Balances data={data} onChange={() => void refetch()} />
            <Planned onChange={() => void refetch()} />
          </Group>

          <Paper withBorder p="md">
            <Title order={5} mb="xs">What's coming</Title>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Date</Table.Th>
                  <Table.Th>What</Table.Th>
                  <Table.Th>Type</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th ta="right">Balance after</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.events
                  .filter((e) => e.kind !== 'typical_spending')
                  .map((e, i) => (
                    <Table.Tr key={i}>
                      <Table.Td>{shortDate(e.date)}</Table.Td>
                      <Table.Td>{e.label}</Table.Td>
                      <Table.Td>
                        <Badge size="sm" variant="light" color={KIND_LABEL[e.kind]?.[1]} tt="none">{KIND_LABEL[e.kind]?.[0] ?? e.kind}</Badge>
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace" c={e.amountCents > 0 ? 'teal.7' : undefined}>{money(e.amountCents)}</Table.Td>
                      <Table.Td ta="right" ff="monospace" c={e.balanceAfterCents < 0 ? 'red' : 'dimmed'}>{money(e.balanceAfterCents)}</Table.Td>
                    </Table.Tr>
                  ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </Stack>
      )}
    </>
  );
}

function Balances({ data, onChange }: { data: CashFlowResponse; onChange: () => void }) {
  const refresh = useRefreshAll();
  const [edit, setEdit] = useState<Record<number, number | string>>({});
  const save = useMutation({
    mutationFn: ({ id, cents }: { id: number; cents: number }) => api.patch(`/api/accounts/${id}`, { balanceCents: cents, balanceDate: data.today }),
    onSuccess: () => {
      refresh();
      onChange();
    },
    onError: notifyError,
  });
  return (
    <Paper withBorder p="md">
      <Title order={5} mb={4}>Account balances</Title>
      <Text size="xs" c="dimmed" mb="xs">
        Filled in automatically from QFX/OFX files and CSVs with a balance column; otherwise type today's balance (cards: amount owed as a negative number).
      </Text>
      <Table fz="sm" verticalSpacing={4}>
        <Table.Tbody>
          {data.balances.map((b) => (
            <Table.Tr key={b.id}>
              <Table.Td>
                {b.name}
                <Text size="xs" c="dimmed">
                  {ACCOUNT_TYPE_LABEL[b.type]}
                  {b.balanceDate ? ` · as of ${shortDate(b.balanceDate)}` : ''}
                </Text>
              </Table.Td>
              <Table.Td ta="right" ff="monospace">{b.currentCents === null ? '—' : money(b.currentCents)}</Table.Td>
              <Table.Td w={190}>
                <Group gap={4} wrap="nowrap">
                  <NumberInput size="xs" prefix="$" decimalScale={2} thousandSeparator placeholder="Today's balance" value={edit[b.id] ?? ''} onChange={(v) => setEdit({ ...edit, [b.id]: v })} />
                  <Button size="xs" variant="default" disabled={edit[b.id] === undefined || edit[b.id] === ''} onClick={() => save.mutate({ id: b.id, cents: Math.round(Number(edit[b.id]) * 100) })}>
                    Set
                  </Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

function Planned({ onChange }: { onChange: () => void }) {
  const { data, refetch } = useQuery({ queryKey: ['planned'], queryFn: () => api.get<{ id: number; date: string; amountCents: number; description: string }[]>('/api/planned') });
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState<number | string>('');
  const [desc, setDesc] = useState('');
  const [dir, setDir] = useState('out');
  const add = useMutation({
    mutationFn: () => api.post('/api/planned', { date, description: desc, amountCents: Math.round(Number(amount) * 100) * (dir === 'out' ? -1 : 1) }),
    onSuccess: () => {
      setAmount('');
      setDesc('');
      void refetch();
      onChange();
    },
    onError: notifyError,
  });
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/planned/${id}`),
    onSuccess: () => {
      void refetch();
      onChange();
    },
  });
  return (
    <Paper withBorder p="md">
      <Title order={5} mb={4}>Planned one-offs</Title>
      <Text size="xs" c="dimmed" mb="xs">Big purchases or expected payments that aren't recurring (new camera, a project fee).</Text>
      {(data ?? []).map((p) => (
        <Group key={p.id} justify="space-between" py={2}>
          <Text size="sm">{shortDate(p.date)} · {p.description}</Text>
          <Group gap={4}>
            <Text size="sm" ff="monospace">{money(p.amountCents)}</Text>
            <ActionIcon variant="subtle" color="gray" onClick={() => del.mutate(p.id)} aria-label="Remove"><IconTrash size={14} /></ActionIcon>
          </Group>
        </Group>
      ))}
      <Group gap={4} mt="xs" align="flex-end" wrap="wrap">
        <SegmentedControl size="xs" value={dir} onChange={setDir} data={[{ value: 'out', label: 'Out' }, { value: 'in', label: 'In' }]} />
        <TextInput size="xs" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
        <NumberInput size="xs" w={110} prefix="$" placeholder="Amount" value={amount} onChange={setAmount} />
        <TextInput size="xs" placeholder="What" value={desc} onChange={(e) => setDesc(e.currentTarget.value)} />
        <Button size="xs" variant="default" disabled={!date || !amount || !desc} onClick={() => add.mutate()}>Add</Button>
      </Group>
    </Paper>
  );
}

function Kpi({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} fz={24} ff="monospace" c={color}>{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}
