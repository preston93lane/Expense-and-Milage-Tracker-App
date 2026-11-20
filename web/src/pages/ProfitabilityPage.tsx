import { Alert, Anchor, Badge, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconCar, IconInfoCircle } from '@tabler/icons-react';
import { formatMinutes } from '@et/core';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/bits';
import { money } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

type Verdict = 'no_time' | 'above_target' | 'near_target' | 'below_target' | 'no_target';

interface ProfitRow {
  key: string;
  name: string;
  incomeCents: number;
  directCostCents: number;
  profitCents: number;
  minutes: number;
  billableMinutes: number;
  unbilledValueCents: number;
  effectiveHourlyCents: number | null;
  verdict: Verdict;
  clientId?: number;
  projectId?: number;
  hourlyRateCents?: number | null;
}

interface ProfitData {
  year: number;
  targetHourlyCents: number | null;
  clients: ProfitRow[];
  projects: ProfitRow[];
  overall: { netProfitCents: number; minutes: number; effectiveHourlyCents: number | null; overheadMinutes: number; overheadPct: number };
}

const VERDICT: Record<Verdict, { label: string; color: string } | null> = {
  above_target: { label: 'at or above target', color: 'teal' },
  near_target: { label: 'near target', color: 'yellow' },
  below_target: { label: 'below target', color: 'orange' },
  no_time: { label: 'no time tracked', color: 'gray' },
  no_target: null,
};

export function ProfitabilityPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data } = useQuery({ queryKey: ['profitability', year], queryFn: () => api.get<ProfitData>(`/api/profitability?year=${year}`) });
  const years = Array.from({ length: 5 }, (_, i) => String(thisYear - 3 + i));

  return (
    <>
      <PageHeader
        title="Profitability"
        description="What each client and project really pays you per hour once direct costs (contractors, travel, gear rentals) are taken out — plus whether your car is cheaper to deduct by the mile or by actual costs."
        right={<Select w={100} data={years} value={String(year)} onChange={(v) => v && setYear(Number(v))} aria-label="Year" allowDeselect={false} />}
      />
      {!data ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Kpi
              label="Your business, per hour"
              value={data.overall.effectiveHourlyCents !== null ? `${money(data.overall.effectiveHourlyCents)}/h` : '—'}
              hint={`Profit ${money(data.overall.netProfitCents)} ÷ ${formatMinutes(data.overall.minutes)} tracked`}
            />
            <Kpi label="Time not tied to a client" value={`${data.overall.overheadPct}%`} hint={`${formatMinutes(data.overall.overheadMinutes)} of admin, marketing, learning…`} />
            <Kpi
              label="Your target"
              value={data.targetHourlyCents ? `${money(data.targetHourlyCents)}/h` : 'Not set'}
              hint={data.targetHourlyCents ? 'Set under Time tracking → Rates' : 'Set one under Time tracking → Rates'}
            />
          </SimpleGrid>

          {data.overall.minutes === 0 && (
            <Alert color="blue" icon={<IconInfoCircle size={18} />}>
              Track your hours on the <Anchor component={Link} to="/time">Time tracking</Anchor> page to see what each client pays per hour. Tag income and costs with a client
              (or put them on a client’s trip) so they’re counted here.
            </Alert>
          )}

          <ProfitTable title="Clients" rows={data.clients} link={(r) => (r.clientId ? `/clients/${r.clientId}` : null)} empty="No client income, costs or time this year yet." />
          {data.projects.length > 0 && <ProfitTable title="Projects" rows={data.projects} link={() => null} empty="" />}
          <VehicleCard year={year} />
        </Stack>
      )}
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fw={700} fz={24} ff="monospace">
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

function ProfitTable({ title, rows, link, empty }: { title: string; rows: ProfitRow[]; link: (r: ProfitRow) => string | null; empty: string }) {
  return (
    <Paper withBorder p="md">
      <Title order={5} mb="xs">
        {title}
      </Title>
      {rows.length === 0 ? (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table fz="sm" verticalSpacing={6} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{title.replace(/s$/, '')}</Table.Th>
                <Table.Th ta="right">Income</Table.Th>
                <Table.Th ta="right">Direct costs</Table.Th>
                <Table.Th ta="right">Profit</Table.Th>
                <Table.Th ta="right">Hours</Table.Th>
                <Table.Th ta="right">Per hour</Table.Th>
                <Table.Th ta="right">Unbilled</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r) => {
                const to = link(r);
                const v = VERDICT[r.verdict];
                return (
                  <Table.Tr key={r.key}>
                    <Table.Td>
                      {to ? (
                        <Anchor component={Link} to={to} size="sm">
                          {r.name}
                        </Anchor>
                      ) : (
                        r.name
                      )}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {money(r.incomeCents)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {money(r.directCostCents)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace" fw={600}>
                      {money(r.profitCents)}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {r.minutes ? formatMinutes(r.minutes) : '—'}
                    </Table.Td>
                    <Table.Td ta="right">
                      <Text size="sm" ff="monospace" fw={600}>
                        {r.effectiveHourlyCents !== null ? `${money(r.effectiveHourlyCents)}/h` : '—'}
                      </Text>
                      {v && (
                        <Badge size="xs" variant="light" color={v.color}>
                          {v.label}
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td ta="right" ff="monospace">
                      {r.unbilledValueCents ? money(r.unbilledValueCents) : '—'}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Paper>
  );
}

interface VehicleData {
  year: number;
  saved: boolean;
  inputs: {
    vehicleName: string | null;
    totalMiles: number;
    businessMiles: number;
    insuranceCents: number;
    registrationCents: number;
    loanInterestCents: number;
    leaseCents: number;
    depreciationCents: number;
    otherCents: number;
    firstYearMethod: 'standard' | 'actual' | null;
  };
  mileageMethod: string;
  milesSource: 'drives' | 'manual';
  averageRateCents: number;
  operatingCents: number;
  operatingCount: number;
  comparison: {
    businessPct: number;
    actualTotalCents: number;
    actualDeductionCents: number;
    standardDeductionCents: number;
    better: 'standard' | 'actual' | 'same' | 'unknown';
    differenceCents: number;
    notes: string[];
  };
}

const CENT_FIELDS: [keyof VehicleData['inputs'], string][] = [
  ['insuranceCents', 'Insurance'],
  ['registrationCents', 'Registration & license'],
  ['loanInterestCents', 'Car loan interest'],
  ['leaseCents', 'Lease payments'],
  ['depreciationCents', 'Depreciation'],
  ['otherCents', 'Other (garage rent, etc.)'],
];

function VehicleCard({ year }: { year: number }) {
  const refresh = useRefreshAll();
  const { data, refetch } = useQuery({ queryKey: ['vehicle', year], queryFn: () => api.get<VehicleData>(`/api/vehicle/${year}`) });
  const [f, setF] = useState<VehicleData['inputs'] | null>(null);
  useEffect(() => setF(data?.inputs ?? null), [data?.inputs]);
  const save = useMutation({
    mutationFn: () => api.put(`/api/vehicle/${year}`, f),
    onSuccess: () => {
      refresh();
      void refetch();
    },
    onError: notifyError,
  });
  if (!data || !f) return null;
  const c = data.comparison;
  const dollars = (k: keyof VehicleData['inputs']) => (
    <NumberInput
      key={k}
      label={CENT_FIELDS.find((x) => x[0] === k)![1]}
      prefix="$"
      thousandSeparator
      min={0}
      decimalScale={2}
      value={(f[k] as number) / 100 || ''}
      onChange={(v) => setF({ ...f, [k]: v === '' ? 0 : Math.round(Number(v) * 100) })}
    />
  );
  return (
    <Paper withBorder p="md">
      <Title order={5} mb={4}>
        <Group gap={6}>
          <IconCar size={18} /> Car: standard mileage rate vs actual costs ({year})
        </Group>
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Gas, oil and repairs come from transactions in the “Vehicle: gas, repairs, insurance” category ({data.operatingCount} so far · {money(data.operatingCents)}). Fill in the
        rest for the year. You’re using the <b>{data.mileageMethod === 'actual' ? 'actual-expense' : 'standard mileage'}</b> method (change it in Settings).
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <Stack gap="xs">
          <Group grow>
            <TextInput label="Car" placeholder="e.g. 2022 RAV4" value={f.vehicleName ?? ''} onChange={(e) => setF({ ...f, vehicleName: e.currentTarget.value })} />
            <Select
              label="Method in this car’s first business year"
              data={[
                { value: 'standard', label: 'Standard mileage rate' },
                { value: 'actual', label: 'Actual expenses' },
              ]}
              clearable
              placeholder="Not sure / this year"
              value={f.firstYearMethod}
              onChange={(v) => setF({ ...f, firstYearMethod: (v as 'standard' | 'actual' | null) ?? null })}
            />
          </Group>
          <Group grow>
            <NumberInput label="Total miles this year" thousandSeparator min={0} value={f.totalMiles || ''} onChange={(v) => setF({ ...f, totalMiles: Number(v) || 0 })} />
            <NumberInput
              label="Business miles"
              description={data.milesSource === 'drives' ? 'Taken from your logged drives' : 'Until mileage tracking is set up'}
              thousandSeparator
              min={0}
              disabled={data.milesSource === 'drives'}
              value={f.businessMiles || ''}
              onChange={(v) => setF({ ...f, businessMiles: Number(v) || 0 })}
            />
          </Group>
          <SimpleGrid cols={2} spacing="xs">
            {CENT_FIELDS.map(([k]) => dollars(k))}
          </SimpleGrid>
          <Button w="fit-content" onClick={() => save.mutate()} loading={save.isPending}>
            Save and compare
          </Button>
        </Stack>
        <Stack gap="xs">
          <Table fz="sm">
            <Table.Tbody>
              <Table.Tr>
                <Table.Td>Standard rate ({data.averageRateCents.toFixed(1)}¢/mile avg.)</Table.Td>
                <Table.Td ta="right" ff="monospace" fw={c.better === 'standard' ? 700 : 400}>
                  {money(c.standardDeductionCents)}
                </Table.Td>
              </Table.Tr>
              <Table.Tr>
                <Table.Td>
                  Actual costs {money(c.actualTotalCents)} × {c.businessPct}% business
                </Table.Td>
                <Table.Td ta="right" ff="monospace" fw={c.better === 'actual' ? 700 : 400}>
                  {money(c.actualDeductionCents)}
                </Table.Td>
              </Table.Tr>
            </Table.Tbody>
          </Table>
          {c.better === 'unknown' ? null : (
            <Alert color={c.better === 'same' ? 'gray' : 'teal'} p="sm">
              {c.better === 'same'
                ? 'Both methods give about the same deduction.'
                : `${c.better === 'standard' ? 'The standard mileage rate' : 'Actual expenses'} gives ${money(c.differenceCents)} more deduction this year.`}
            </Alert>
          )}
          {c.notes.map((n) => (
            <Text key={n} size="xs" c="dimmed">
              • {n}
            </Text>
          ))}
        </Stack>
      </SimpleGrid>
    </Paper>
  );
}
