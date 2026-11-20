import { ActionIcon, Alert, Badge, Button, Group, Modal, NumberInput, Paper, Progress, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { LineChart } from '../components/LineChart';
import { PageHeader } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

type AccountType = 'sep_ira' | 'solo_401k' | 'traditional_ira' | 'roth_ira' | '401k' | 'hsa' | 'brokerage' | 'other';
const TYPE_LABEL: Record<AccountType, string> = {
  sep_ira: 'SEP-IRA',
  solo_401k: 'Solo 401(k)',
  traditional_ira: 'Traditional IRA',
  roth_ira: 'Roth IRA',
  '401k': '401(k) (employer)',
  hsa: 'HSA',
  brokerage: 'Brokerage (taxable)',
  other: 'Other',
};

interface Account {
  id: number;
  name: string;
  type: AccountType;
  balanceCents: number;
  balanceDate: string | null;
  expectedReturnPct: number;
  plannedAnnualCents: number;
  notes: string | null;
  contributedThisYearCents: number;
  contributions: { id: number; date: string; amountCents: number; taxYear: number; transactionId: number | null; note: string | null }[];
}

interface RetirementData {
  year: number;
  profile: { birthYear: number | null; retireAge: number; inflationPct: number; withdrawalPct: number };
  age: number | null;
  accounts: Account[];
  limits: {
    netEarningsCents: number;
    sepMaxCents: number;
    solo401kEmployeeMaxCents: number;
    solo401kEmployerMaxCents: number;
    solo401kTotalMaxCents: number;
    iraMaxCents: number;
    catchUpCents: number;
    notes: string[];
  };
  projection: {
    years: { year: number; age: number; balanceCents: number; realBalanceCents: number; contributedCents: number }[];
    atRetirement: { year: number; age: number; balanceCents: number; realBalanceCents: number; annualIncomeRealCents: number; monthlyIncomeRealCents: number } | null;
    totalContributedCents: number;
  } | null;
  unassigned: { id: number; date: string; amountCents: number; merchant: string }[];
  plannedTotalCents: number;
  actualTotalCents: number;
  onTrackCents: number;
  projectedProfitCents: number;
  marginalRate: number;
}

export function RetirementPage() {
  const year = new Date().getFullYear();
  const refresh = useRefreshAll();
  const { data, refetch } = useQuery({ queryKey: ['retirement', year], queryFn: () => api.get<RetirementData>(`/api/retirement?year=${year}`) });
  const [editing, setEditing] = useState<Partial<Account> | null>(null);
  const [profile, setProfile] = useState<RetirementData['profile'] | null>(null);
  useEffect(() => setProfile(data?.profile ?? null), [data?.profile]);
  const saveProfile = useMutation({ mutationFn: () => api.put('/api/retirement/profile', profile), onSuccess: () => void refetch(), onError: notifyError });
  const assign = useMutation({
    mutationFn: (b: { accountId: number; transactionId: number }) => api.post('/api/retirement/contributions', b),
    onSuccess: () => {
      refresh();
      void refetch();
    },
    onError: notifyError,
  });
  const delContribution = useMutation({ mutationFn: (id: number) => api.del(`/api/retirement/contributions/${id}`), onSuccess: () => void refetch() });

  if (!data || !profile) return <Text c="dimmed">Loading…</Text>;
  const total = data.accounts.reduce((s, a) => s + a.balanceCents, 0);
  const proj = data.projection;
  const taxSaved = Math.round(data.actualTotalCents * data.marginalRate);

  return (
    <>
      <PageHeader
        title="Retirement"
        description="What you're allowed to put away as a self-employed person, how this year's contributions compare with your plan, and where it all could lead. Projections assume a steady return — real markets aren't steady."
        right={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ type: 'sep_ira', expectedReturnPct: 6 })}>
            Add account
          </Button>
        }
      />
      <Stack>
        <SimpleGrid cols={{ base: 2, md: 4 }}>
          <Kpi label="Saved so far" value={money(total)} hint={`${data.accounts.length} account${data.accounts.length === 1 ? '' : 's'}`} />
          <Paper withBorder p="md">
            <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Contributed in {year}</Text>
            <Text fw={700} fz={24} ff="monospace">{money(data.actualTotalCents)}</Text>
            {data.plannedTotalCents > 0 && (
              <>
                <Progress value={Math.min(100, (data.actualTotalCents / data.plannedTotalCents) * 100)} color={data.actualTotalCents >= data.onTrackCents ? 'teal' : 'orange'} mt={4} />
                <Text size="xs" c="dimmed" mt={2}>
                  of {money(data.plannedTotalCents)} planned · {data.actualTotalCents >= data.onTrackCents ? 'on track' : `${money(data.onTrackCents - data.actualTotalCents)} behind pace`}
                </Text>
              </>
            )}
          </Paper>
          <Kpi label="Most you can put in (Solo 401k)" value={money(data.limits.solo401kTotalMaxCents)} hint={`SEP-IRA max ${money(data.limits.sepMaxCents)} · IRA ${money(data.limits.iraMaxCents)}`} />
          <Kpi label="Tax saved this year (approx.)" value={money(taxSaved)} hint={`Pre-tax contributions × your ${Math.round(data.marginalRate * 100)}% bracket`} />
        </SimpleGrid>

        {data.unassigned.length > 0 && (
          <Paper withBorder p="md">
            <Title order={5} mb="xs">Retirement payments found in your bank data</Title>
            {data.unassigned.map((t) => (
              <Group key={t.id} justify="space-between" py={2}>
                <Text size="sm">{shortDate(t.date)} · {t.merchant} · {money(t.amountCents)}</Text>
                <Select
                  size="xs"
                  w={220}
                  placeholder="Which account?"
                  data={data.accounts.map((a) => ({ value: String(a.id), label: a.name }))}
                  onChange={(v) => v && assign.mutate({ accountId: Number(v), transactionId: t.id })}
                />
              </Group>
            ))}
          </Paper>
        )}

        <SimpleGrid cols={{ base: 1, lg: 2 }}>
          <Paper withBorder p="md">
            <Title order={5} mb="xs">Accounts</Title>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Tbody>
                {data.accounts.map((a) => (
                  <Table.Tr key={a.id}>
                    <Table.Td>
                      <Text size="sm" fw={500}>{a.name}</Text>
                      <Text size="xs" c="dimmed">{TYPE_LABEL[a.type]} · {a.expectedReturnPct}%/yr assumed{a.balanceDate ? ` · balance as of ${shortDate(a.balanceDate)}` : ''}</Text>
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(a.balanceCents)}</Table.Td>
                    <Table.Td ta="right">
                      <Text size="xs">{money(a.contributedThisYearCents)} / {money(a.plannedAnnualCents)} planned</Text>
                    </Table.Td>
                    <Table.Td w={40}>
                      <ActionIcon variant="subtle" onClick={() => setEditing(a)} aria-label="Edit account"><IconPencil size={14} /></ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
                {data.accounts.length === 0 && (
                  <Table.Tr><Table.Td><Text size="sm" c="dimmed">Add your SEP-IRA, Solo 401(k), IRAs, HSA, etc. with today's balance.</Text></Table.Td></Table.Tr>
                )}
              </Table.Tbody>
            </Table>
            {data.accounts.some((a) => a.contributions.length > 0) && (
              <>
                <Text size="sm" fw={600} mt="md" mb={4}>Recent contributions</Text>
                <Table fz="xs" verticalSpacing={2}>
                  <Table.Tbody>
                    {data.accounts.flatMap((a) => a.contributions.map((c) => ({ ...c, account: a.name }))).sort((x, y) => y.date.localeCompare(x.date)).slice(0, 12).map((c) => (
                      <Table.Tr key={c.id}>
                        <Table.Td>{shortDate(c.date)}</Table.Td>
                        <Table.Td>{c.account}</Table.Td>
                        <Table.Td>for {c.taxYear}</Table.Td>
                        <Table.Td ta="right" ff="monospace">{money(c.amountCents)}</Table.Td>
                        <Table.Td w={30}><ActionIcon size="xs" variant="subtle" color="gray" onClick={() => delContribution.mutate(c.id)} aria-label="Remove"><IconTrash size={12} /></ActionIcon></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </>
            )}
            <ManualContribution accounts={data.accounts} onDone={() => void refetch()} />
          </Paper>

          <Paper withBorder p="md">
            <Title order={5} mb="xs">{year} limits for you</Title>
            <Text size="xs" c="dimmed" mb="xs">Based on projected profit {money(data.projectedProfitCents)} (net earnings for retirement {money(data.limits.netEarningsCents)}).</Text>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Tbody>
                <Table.Tr><Table.Td>SEP-IRA (20% of net earnings)</Table.Td><Table.Td ta="right" ff="monospace">{money(data.limits.sepMaxCents)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Solo 401(k) — you as employee{data.limits.catchUpCents ? ' (incl. catch-up)' : ''}</Table.Td><Table.Td ta="right" ff="monospace">{money(data.limits.solo401kEmployeeMaxCents)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>Solo 401(k) — business as employer (20%)</Table.Td><Table.Td ta="right" ff="monospace">{money(data.limits.solo401kEmployerMaxCents)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td fw={600}>Solo 401(k) total</Table.Td><Table.Td ta="right" ff="monospace" fw={600}>{money(data.limits.solo401kTotalMaxCents)}</Table.Td></Table.Tr>
                <Table.Tr><Table.Td>IRA (traditional or Roth, if eligible)</Table.Td><Table.Td ta="right" ff="monospace">{money(data.limits.iraMaxCents)}</Table.Td></Table.Tr>
              </Table.Tbody>
            </Table>
            {data.limits.notes.map((n) => <Text key={n} size="xs" c="dimmed" mt={4}>{n}</Text>)}
            <Text size="xs" c="dimmed" mt="xs">
              SEP-IRA contributions for {year} can be made until your tax filing deadline (incl. extensions). A Solo 401(k) usually must be opened by
              Dec 31 for employee deferrals. Roth IRA eligibility depends on income.
            </Text>
          </Paper>
        </SimpleGrid>

        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs" wrap="wrap" align="flex-end">
            <Title order={5}>Projection</Title>
            <Group gap="xs" align="flex-end">
              <NumberInput size="xs" w={110} label="Birth year" value={profile.birthYear ?? ''} onChange={(v) => setProfile({ ...profile, birthYear: v === '' ? null : Number(v) })} />
              <NumberInput size="xs" w={110} label="Retire at age" min={30} max={90} value={profile.retireAge} onChange={(v) => setProfile({ ...profile, retireAge: Number(v) || 65 })} />
              <NumberInput size="xs" w={100} label="Inflation %" min={0} max={15} decimalScale={1} value={profile.inflationPct} onChange={(v) => setProfile({ ...profile, inflationPct: Number(v) })} />
              <NumberInput size="xs" w={110} label="Withdrawal %" min={0} max={15} decimalScale={1} value={profile.withdrawalPct} onChange={(v) => setProfile({ ...profile, withdrawalPct: Number(v) })} />
              <Button size="xs" variant="default" onClick={() => saveProfile.mutate()}>Update</Button>
            </Group>
          </Group>
          {!proj && <Alert color="gray" variant="light">Add your birth year to see the projection.</Alert>}
          {proj && proj.atRetirement && (
            <>
              <SimpleGrid cols={{ base: 1, sm: 3 }} mb="sm">
                <Kpi label={`At ${proj.atRetirement.age} (${proj.atRetirement.year})`} value={money(proj.atRetirement.balanceCents)} hint={`${money(proj.atRetirement.realBalanceCents)} in today's dollars`} />
                <Kpi label="Yearly income it could support" value={money(proj.atRetirement.annualIncomeRealCents)} hint={`${money(proj.atRetirement.monthlyIncomeRealCents)}/month in today's dollars (${profile.withdrawalPct}% rule)`} />
                <Kpi label="You'd contribute" value={money(proj.totalContributedCents)} hint="Planned contributions until retirement" />
              </SimpleGrid>
              <LineChart
                ariaLabel="Projected retirement savings by age"
                labels={proj.years.map((y) => `${y.age}`)}
                series={[
                  { name: 'Projected balance', color: 'var(--mantine-color-blue-7)', values: proj.years.map((y) => y.balanceCents) },
                  { name: "In today's dollars", color: 'var(--mantine-color-orange-7)', values: proj.years.map((y) => y.realBalanceCents) },
                ]}
              />
              <Text size="xs" c="dimmed" mt="xs">X-axis: your age. Uses each account's assumed return and planned yearly contribution.</Text>
            </>
          )}
        </Paper>
      </Stack>
      {editing && <AccountModal initial={editing} onClose={() => { setEditing(null); void refetch(); }} />}
    </>
  );
}

function ManualContribution({ accounts, onDone }: { accounts: Account[]; onDone: () => void }) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | string>('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [taxYear, setTaxYear] = useState<number | string>(new Date().getFullYear());
  const add = useMutation({
    mutationFn: () => api.post('/api/retirement/contributions', { accountId: Number(accountId), amountCents: Math.round(Number(amount) * 100), date, taxYear: Number(taxYear) }),
    onSuccess: () => {
      setAmount('');
      onDone();
    },
    onError: notifyError,
  });
  if (accounts.length === 0) return null;
  return (
    <Group gap={4} mt="md" align="flex-end" wrap="wrap">
      <Select size="xs" w={160} placeholder="Account" value={accountId} onChange={setAccountId} data={accounts.map((a) => ({ value: String(a.id), label: a.name }))} label="Record a contribution" />
      <NumberInput size="xs" w={110} prefix="$" placeholder="Amount" value={amount} onChange={setAmount} />
      <TextInput size="xs" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
      <NumberInput size="xs" w={90} label="For tax year" value={taxYear} onChange={setTaxYear} />
      <Button size="xs" variant="default" disabled={!accountId || !amount} onClick={() => add.mutate()}>Add</Button>
    </Group>
  );
}

function AccountModal({ initial, onClose }: { initial: Partial<Account>; onClose: () => void }) {
  const refresh = useRefreshAll();
  const [name, setName] = useState(initial.name ?? '');
  const [type, setType] = useState<AccountType>(initial.type ?? 'sep_ira');
  const [balance, setBalance] = useState<number | string>(initial.balanceCents !== undefined ? initial.balanceCents / 100 : '');
  const [ret, setRet] = useState<number | string>(initial.expectedReturnPct ?? 6);
  const [planned, setPlanned] = useState<number | string>(initial.plannedAnnualCents ? initial.plannedAnnualCents / 100 : '');
  const body = () => ({ name, type, balanceCents: Math.round(Number(balance || 0) * 100), expectedReturnPct: Number(ret), plannedAnnualCents: Math.round(Number(planned || 0) * 100) });
  const save = useMutation({
    mutationFn: () => (initial.id ? api.patch(`/api/retirement/accounts/${initial.id}`, body()) : api.post('/api/retirement/accounts', body())),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });
  const del = useMutation({ mutationFn: () => api.del(`/api/retirement/accounts/${initial.id}`), onSuccess: onClose });
  return (
    <Modal opened onClose={onClose} title={initial.id ? 'Edit account' : 'Add retirement account'}>
      <Stack>
        <TextInput label="Name" placeholder="e.g. Fidelity SEP-IRA" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select label="Type" value={type} onChange={(v) => v && setType(v as AccountType)} data={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <NumberInput label="Balance today" prefix="$" thousandSeparator decimalScale={2} value={balance} onChange={setBalance} />
        <NumberInput label="Planned contribution per year" prefix="$" thousandSeparator value={planned} onChange={setPlanned} />
        <NumberInput label="Assumed yearly return %" description="Long-run stock-heavy portfolios are often modeled at 5–7%" min={-10} max={20} decimalScale={1} value={ret} onChange={setRet} />
        <Group justify="space-between">
          {initial.id ? <Button variant="subtle" color="red" onClick={() => del.mutate()}>Delete</Button> : <span />}
          <Button onClick={() => save.mutate()} disabled={!name.trim()} loading={save.isPending}>Save</Button>
        </Group>
        <Badge variant="light" color="gray" tt="none">Balances are typed in by you — nothing connects to your brokerage.</Badge>
      </Stack>
    </Modal>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>{label}</Text>
      <Text fw={700} fz={22} ff="monospace">{value}</Text>
      {hint && <Text size="xs" c="dimmed">{hint}</Text>}
    </Paper>
  );
}
