import { Accordion, Alert, Anchor, Badge, Button, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconDownload, IconInfoCircle, IconPrinter } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

interface TaxSummary {
  year: number;
  profile: {
    filingStatus: 'single' | 'mfj' | 'mfs' | 'hoh';
    w2WagesCents: number;
    otherIncomeCents: number;
    withholdingCents: number;
    priorYearTaxCents: number | null;
    priorYearAgiCents: number | null;
    stateRatePct: number;
    projectionMode: 'pace' | 'ytd' | 'manual';
    projectedProfitCents: number | null;
  };
  profileSaved: boolean;
  scheduleC: {
    line1GrossReceiptsCents: number;
    line2ReturnsCents: number;
    line6OtherIncomeCents: number;
    line7GrossIncomeCents: number;
    expenseLines: { line: string; label: string; amountCents: number; detail: { name: string; amountCents: number; note?: string }[] }[];
    line28TotalExpensesCents: number;
    line29TentativeProfitCents: number;
    line30HomeOfficeCents: number;
    homeOffice: { method: string; businessPct: number; uncappedCents: number; limitedByIncome: boolean; actualExpensesCents: number } | null;
    line31NetProfitCents: number;
    schedule1: { line: string; label: string; amountCents: number }[];
    tracking: { label: string; amountCents: number }[];
    excluded: { name: string; amountCents: number; reason: string }[];
    businessMiles: number;
  };
  projection: { ytdProfitCents: number; projectedProfitCents: number; fractionOfYear: number; note: string };
  estimate: {
    tableExact: boolean;
    seTaxCents: number;
    seTaxDeductionCents: number;
    additionalMedicareCents: number;
    agiCents: number;
    standardDeductionCents: number;
    qbiDeductionCents: number;
    taxableIncomeCents: number;
    incomeTaxCents: number;
    totalFederalCents: number;
    marginalRate: number;
    effectiveRatePct: number;
    stateTaxCents: number;
    withholdingCents: number;
    federalDueCents: number;
    requiredAnnualCents: number;
    safeHarborCents: number | null;
    safeHarborBasis: string;
    setAsidePct: number;
    notes: string[];
  };
  payments: { transactionId: number; date: string; amountCents: number }[];
  paidCents: number;
  quarters: { quarter: number; due: string; amountCents: number; paidCents: number; status: string }[];
  homeOffice: { method: string; office_sqft: number; home_sqft: number; months_used: number } | null;
  unreviewed: number;
}

const Q_STATUS: Record<string, [string, string]> = {
  not_required: ['Not required', 'gray'],
  paid: ['Paid', 'teal'],
  partly_paid: ['Partly paid', 'yellow'],
  due_soon: ['Due soon', 'orange'],
  upcoming: ['Upcoming', 'gray'],
  missed: ['Not paid', 'red'],
};

const dollars = (c: number | null | undefined) => (c === null || c === undefined ? '' : c / 100);
const toCents = (v: number | string) => (v === '' || v === null ? null : Math.round(Number(v) * 100));

export function TaxesPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const refresh = useRefreshAll();
  const { data } = useQuery({ queryKey: ['taxes', year], queryFn: () => api.get<TaxSummary>(`/api/taxes/${year}`) });

  return (
    <>
      <PageHeader
        title="Taxes"
        description="Your Schedule C, an estimate of what you'll owe, and the quarterly payments that keep you penalty-free. Estimates for planning — your tax preparer has the final word."
        right={
          <Group className="no-print">
            <Select w={100} value={String(year)} onChange={(v) => v && setYear(Number(v))} data={Array.from({ length: 5 }, (_, i) => String(thisYear - i))} />
            <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
              Print
            </Button>
            <Button component="a" href={`/api/reports/tax-packet.xlsx?year=${year}`} leftSection={<IconDownload size={16} />}>
              Tax packet (Excel)
            </Button>
          </Group>
        }
      />
      {data && (
        <Stack>
          {data.unreviewed > 0 && (
            <Alert color="orange" variant="light" p="xs">
              <Text size="sm">
                {data.unreviewed} transactions in {year} aren't reviewed yet and aren't counted. <Anchor component={Link} to="/review">Review them</Anchor>
              </Text>
            </Alert>
          )}
          {data.estimate.notes.map((n) => (
            <Alert key={n} color="blue" variant="light" p="xs" icon={<IconInfoCircle size={16} />}>
              <Text size="sm">{n}</Text>
            </Alert>
          ))}

          <SimpleGrid cols={{ base: 2, md: 4 }}>
            <Kpi label={year === thisYear ? 'Projected net profit' : 'Net profit'} value={money(data.projection.projectedProfitCents)} hint={year === thisYear ? `So far: ${money(data.projection.ytdProfitCents)}` : undefined} />
            <Kpi label="Federal tax (estimate)" value={money(data.estimate.totalFederalCents)} hint={`${money(data.estimate.seTaxCents)} self-employment + ${money(data.estimate.incomeTaxCents)} income`} />
            <Kpi label="Set aside from each payment" value={`${data.estimate.setAsidePct}%`} hint={data.profile.stateRatePct ? 'Federal + state' : 'Federal only — add a state rate below'} />
            <Kpi label="Estimated payments" value={`${money(data.paidCents)} paid`} hint={`of ${money(data.estimate.requiredAnnualCents)} needed (${data.estimate.safeHarborBasis})`} />
          </SimpleGrid>

          <Paper withBorder p="md">
            <Group justify="space-between" mb="xs">
              <Title order={5}>Quarterly estimated payments (Form 1040-ES)</Title>
              <Anchor href="https://www.irs.gov/payments/direct-pay" target="_blank" rel="noreferrer" size="sm" className="no-print">
                Pay with IRS Direct Pay ↗
              </Anchor>
            </Group>
            <Table fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Quarter</Table.Th>
                  <Table.Th>Due</Table.Th>
                  <Table.Th ta="right">Amount</Table.Th>
                  <Table.Th ta="right">Paid</Table.Th>
                  <Table.Th>Status</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.quarters.map((q) => (
                  <Table.Tr key={q.quarter}>
                    <Table.Td>Q{q.quarter}</Table.Td>
                    <Table.Td>{shortDate(q.due)}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(q.amountCents)}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(q.paidCents)}</Table.Td>
                    <Table.Td>
                      <Badge color={Q_STATUS[q.status][1]} variant="light">{Q_STATUS[q.status][0]}</Badge>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="xs" c="dimmed" mt="xs">
              Payments are found automatically: categorize your IRS payments as “Estimated tax payment (federal)”. Paying the safe-harbor amount
              on time avoids underpayment penalties even if you owe more in April. State estimates are separate.
            </Text>
          </Paper>

          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <ScheduleCCard data={data} />
            <Stack>
              <EstimateCard data={data} />
              <ProfileForm data={data} onSaved={refresh} />
              <HomeOfficeForm data={data} onSaved={refresh} />
            </Stack>
          </SimpleGrid>

          <Paper withBorder p="md" className="no-print">
            <Title order={5} mb="xs">Other year-end paperwork</Title>
            <Group gap="lg">
              <Anchor component={Link} to="/contractors">1099-NECs you must send</Anchor>
              <Anchor component={Link} to="/income">1099s you may receive</Anchor>
              <Anchor component={Link} to="/retirement">Retirement contributions (Schedule 1 line 16)</Anchor>
              <Anchor component={Link} to="/trips">Trip reports</Anchor>
            </Group>
          </Paper>
        </Stack>
      )}
    </>
  );
}

function ScheduleCCard({ data }: { data: TaxSummary }) {
  const sc = data.scheduleC;
  const row = (line: string, label: string, cents: number, bold = false) => (
    <Table.Tr key={`${line}-${label}`}>
      <Table.Td w={60} fw={bold ? 700 : undefined}>{line}</Table.Td>
      <Table.Td fw={bold ? 700 : undefined}>{label}</Table.Td>
      <Table.Td ta="right" ff="monospace" fw={bold ? 700 : undefined}>{money(cents)}</Table.Td>
    </Table.Tr>
  );
  return (
    <Paper withBorder p="md">
      <Title order={5}>Schedule C — {data.year}{data.year === new Date().getFullYear() ? ' so far' : ''}</Title>
      <Text size="xs" c="dimmed" mb="xs">Line numbers match the IRS form, so you can copy them into tax software.</Text>
      <Table fz="sm" verticalSpacing={4}>
        <Table.Tbody>
          {row('1', 'Gross receipts or sales', sc.line1GrossReceiptsCents)}
          {sc.line2ReturnsCents ? row('2', 'Returns and allowances', sc.line2ReturnsCents) : null}
          {sc.line6OtherIncomeCents ? row('6', 'Other income', sc.line6OtherIncomeCents) : null}
          {row('7', 'Gross income', sc.line7GrossIncomeCents, true)}
        </Table.Tbody>
      </Table>
      <Accordion variant="contained" my="xs" chevronPosition="left">
        {sc.expenseLines.map((l) => (
          <Accordion.Item key={l.line} value={l.line}>
            <Accordion.Control py={4}>
              <Group justify="space-between" wrap="nowrap" pr="xs">
                <Text size="sm">
                  <b>{l.line}</b> {l.label}
                </Text>
                <Text size="sm" ff="monospace">{money(l.amountCents)}</Text>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>
              {l.detail.map((d) => (
                <Group key={d.name} justify="space-between">
                  <Text size="xs">{d.name}{d.note ? ` — ${d.note}` : ''}</Text>
                  <Text size="xs" ff="monospace">{money(d.amountCents)}</Text>
                </Group>
              ))}
            </Accordion.Panel>
          </Accordion.Item>
        ))}
      </Accordion>
      <Table fz="sm" verticalSpacing={4}>
        <Table.Tbody>
          {row('28', 'Total expenses', sc.line28TotalExpensesCents, true)}
          {row('29', 'Tentative profit', sc.line29TentativeProfitCents)}
          {row('30', `Business use of home${sc.homeOffice ? ` (${sc.homeOffice.method})` : ''}`, sc.line30HomeOfficeCents)}
          {row('31', 'Net profit', sc.line31NetProfitCents, true)}
        </Table.Tbody>
      </Table>
      {(sc.schedule1.length > 0 || sc.tracking.length > 0 || sc.excluded.length > 0) && (
        <Table fz="xs" mt="sm" verticalSpacing={2}>
          <Table.Tbody>
            {sc.schedule1.map((x) => (
              <Table.Tr key={x.label}>
                <Table.Td>Schedule 1, line {x.line}</Table.Td>
                <Table.Td>{x.label}</Table.Td>
                <Table.Td ta="right" ff="monospace">{money(x.amountCents)}</Table.Td>
              </Table.Tr>
            ))}
            {sc.tracking.map((x) => (
              <Table.Tr key={x.label}>
                <Table.Td>Tracked</Table.Td>
                <Table.Td>{x.label}</Table.Td>
                <Table.Td ta="right" ff="monospace">{money(x.amountCents)}</Table.Td>
              </Table.Tr>
            ))}
            {sc.excluded.map((x) => (
              <Table.Tr key={x.name}>
                <Table.Td c="dimmed">Not deducted</Table.Td>
                <Table.Td c="dimmed">{x.name} — {x.reason}</Table.Td>
                <Table.Td ta="right" ff="monospace" c="dimmed">{money(x.amountCents)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Text size="xs" c="dimmed" mt="xs">
        Business miles counted: {sc.businessMiles}. {sc.businessMiles ? '' : 'Mileage tracking (Google Maps Timeline) is the next big feature; add miles then.'}
      </Text>
    </Paper>
  );
}

function EstimateCard({ data }: { data: TaxSummary }) {
  const e = data.estimate;
  const rows: [string, number | string][] = [
    ['Projected net profit', data.projection.projectedProfitCents],
    ['Self-employment tax (15.3% of 92.35%)', e.seTaxCents],
    ['− Half of SE tax (deduction)', e.seTaxDeductionCents],
    ['Adjusted gross income', e.agiCents],
    ['− Standard deduction', e.standardDeductionCents],
    ['− Qualified business income deduction (20%)', e.qbiDeductionCents],
    ['Taxable income', e.taxableIncomeCents],
    ['Income tax', e.incomeTaxCents],
    ...(e.additionalMedicareCents ? ([['Additional Medicare tax', e.additionalMedicareCents]] as [string, number][]) : []),
    ['Total federal tax', e.totalFederalCents],
    ['− Withholding', e.withholdingCents],
    ['State (rough, flat rate)', e.stateTaxCents],
  ];
  return (
    <Paper withBorder p="md">
      <Title order={5}>How the estimate works</Title>
      <Text size="xs" c="dimmed" mb="xs">{data.projection.note}</Text>
      <Table fz="sm" verticalSpacing={2}>
        <Table.Tbody>
          {rows.map(([l, v]) => (
            <Table.Tr key={l}>
              <Table.Td>{l}</Table.Td>
              <Table.Td ta="right" ff="monospace">{typeof v === 'number' ? money(v) : v}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" c="dimmed" mt="xs">
        Top bracket: {Math.round(e.marginalRate * 100)}% · effective federal rate {e.effectiveRatePct}% · every extra $1,000 of profit costs about{' '}
        {money(e.setAsidePct * 1000)} in tax.
      </Text>
    </Paper>
  );
}

function ProfileForm({ data, onSaved }: { data: TaxSummary; onSaved: () => void }) {
  const p = data.profile;
  const [f, setF] = useState({ ...p });
  useEffect(() => setF({ ...data.profile }), [data.profile]);
  const save = useMutation({ mutationFn: () => api.put(`/api/taxes/${data.year}/profile`, f), onSuccess: onSaved, onError: notifyError });
  const money$ = (label: string, key: keyof typeof f, description?: string) => (
    <NumberInput
      label={label}
      description={description}
      prefix="$"
      thousandSeparator
      decimalScale={2}
      value={dollars(f[key] as number | null)}
      onChange={(v) => setF({ ...f, [key]: toCents(v) ?? (key === 'priorYearTaxCents' || key === 'priorYearAgiCents' || key === 'projectedProfitCents' ? null : 0) })}
    />
  );
  return (
    <Paper withBorder p="md" className="no-print">
      <Title order={5} mb="xs">Your tax situation ({data.year})</Title>
      {!data.profileSaved && <Text size="xs" c="orange.8" mb="xs">Fill this in once a year — the estimate assumes single with no other income until you do.</Text>}
      <SimpleGrid cols={2} spacing="xs">
        <Select
          label="Filing status"
          value={f.filingStatus}
          onChange={(v) => v && setF({ ...f, filingStatus: v as typeof f.filingStatus })}
          data={[
            { value: 'single', label: 'Single' },
            { value: 'mfj', label: 'Married filing jointly' },
            { value: 'mfs', label: 'Married filing separately' },
            { value: 'hoh', label: 'Head of household' },
          ]}
        />
        <NumberInput label="State tax rate (rough %)" description="e.g. 6 for ~6% effective" suffix="%" min={0} max={20} decimalScale={2} value={f.stateRatePct} onChange={(v) => setF({ ...f, stateRatePct: Number(v) || 0 })} />
        {money$('W-2 wages', 'w2WagesCents', 'Yours (+ spouse if joint)')}
        {money$('Federal withholding', 'withholdingCents', 'From W-2 paychecks')}
        {money$('Other taxable income', 'otherIncomeCents', 'Interest, etc.')}
        {money$("Last year's total tax", 'priorYearTaxCents', 'Form 1040 “total tax”')}
        {money$("Last year's AGI", 'priorYearAgiCents', 'For the 110% rule')}
        <Select
          label="Project the year by"
          value={f.projectionMode}
          onChange={(v) => v && setF({ ...f, projectionMode: v as typeof f.projectionMode })}
          data={[
            { value: 'pace', label: 'Current pace' },
            { value: 'ytd', label: 'Profit so far only' },
            { value: 'manual', label: 'My own number' },
          ]}
        />
        {f.projectionMode === 'manual' && money$('Expected full-year profit', 'projectedProfitCents')}
      </SimpleGrid>
      <Button mt="sm" onClick={() => save.mutate()} loading={save.isPending}>Save</Button>
    </Paper>
  );
}

function HomeOfficeForm({ data, onSaved }: { data: TaxSummary; onSaved: () => void }) {
  const h = data.homeOffice;
  const [method, setMethod] = useState(h?.method ?? 'simplified');
  const [office, setOffice] = useState<number | string>(h?.office_sqft ?? '');
  const [home, setHome] = useState<number | string>(h?.home_sqft ?? '');
  const [months, setMonths] = useState<number | string>(h?.months_used ?? 12);
  useEffect(() => {
    setMethod(data.homeOffice?.method ?? 'simplified');
    setOffice(data.homeOffice?.office_sqft ?? '');
    setHome(data.homeOffice?.home_sqft ?? '');
    setMonths(data.homeOffice?.months_used ?? 12);
  }, [data.homeOffice]);
  const save = useMutation({
    mutationFn: () => api.put(`/api/taxes/${data.year}/home-office`, { method, officeSqft: Number(office) || 0, homeSqft: Number(home) || 0, monthsUsed: Number(months) || 12 }),
    onSuccess: onSaved,
    onError: notifyError,
  });
  const r = data.scheduleC.homeOffice;
  return (
    <Paper withBorder p="md" className="no-print">
      <Title order={5}>Home office</Title>
      <Text size="xs" c="dimmed" mb="xs">
        The space must be used regularly and only for business. Simplified: $5 per sq ft up to 300 sq ft. Actual: your office's share of rent/mortgage
        interest, utilities, insurance and repairs (tag those with the “Home:” categories).
      </Text>
      <SimpleGrid cols={2} spacing="xs">
        <Select label="Method" value={method} onChange={(v) => v && setMethod(v)} data={[{ value: 'simplified', label: 'Simplified ($5/sq ft)' }, { value: 'actual', label: 'Actual expenses (Form 8829)' }]} />
        <NumberInput label="Months used this year" min={1} max={12} value={months} onChange={setMonths} />
        <NumberInput label="Office square feet" min={0} value={office} onChange={setOffice} />
        <NumberInput label="Whole home square feet" min={0} value={home} onChange={setHome} />
      </SimpleGrid>
      {r && (
        <Text size="sm" mt="xs">
          Deduction: <b>{money(data.scheduleC.line30HomeOfficeCents)}</b> ({r.businessPct}% of the home)
          {r.limitedByIncome ? ` — limited by your profit (full amount ${money(r.uncappedCents)}).` : '.'}
        </Text>
      )}
      <Button mt="sm" variant="default" onClick={() => save.mutate()} loading={save.isPending}>Save home office</Button>
    </Paper>
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
