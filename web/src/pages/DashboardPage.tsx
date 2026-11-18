import { Alert, Anchor, Badge, Button, Group, List, Paper, Select, SimpleGrid, Stack, Table, Text, ThemeIcon, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { IconAlertCircle, IconFileImport, IconInbox, IconRobot } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Dashboard } from '../api';
import { PageHeader } from '../components/bits';
import { money, plural } from '../format';
import { useAccounts } from '../hooks';
import { TAX_LINE_BY_CODE } from '@et/core';

function Kpi({ label, value, hint, color }: { label: string; value: string; hint?: React.ReactNode; color?: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
        {label}
      </Text>
      <Text fw={700} fz={26} c={color} ff="monospace">
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" mt={2}>
          {hint}
        </Text>
      )}
    </Paper>
  );
}

export function DashboardPage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = useQuery({ queryKey: ['dashboard', year], queryFn: () => api.get<Dashboard>(`/api/dashboard?year=${year}`) });
  const accounts = useAccounts();
  const noAccounts = accounts.data && accounts.data.length === 0;
  const years = [...new Set([new Date().getFullYear(), ...(data?.years ?? [])])].sort((a, b) => b - a);
  const maxMonth = Math.max(1, ...(data?.monthly ?? []).flatMap((m) => [m.incomeCents, m.expenseCents]));
  const needs = data ? data.review.unreviewed + data.review.suggested : 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your business numbers for the year, from reviewed transactions."
        right={
          <Select w={110} value={String(year)} onChange={(v) => v && setYear(Number(v))} data={years.map(String)} aria-label="Year" />
        }
      />

      {noAccounts && (
        <Paper withBorder p="lg" mb="lg">
          <Title order={4} mb="sm">
            Getting started
          </Title>
          <List spacing="sm" size="sm" icon={<ThemeIcon size={22} radius="xl" variant="light"><IconFileImport size={14} /></ThemeIcon>}>
            <List.Item>
              Download last month's statement from each bank and card (CSV, or .QFX/.QBO if offered) and{' '}
              <Anchor component={Link} to="/import">
                import them
              </Anchor>
              . You'll create each account as you go.
            </List.Item>
            <List.Item icon={<ThemeIcon size={22} radius="xl" variant="light"><IconInbox size={14} /></ThemeIcon>}>
              Work through{' '}
              <Anchor component={Link} to="/review">
                Needs Review
              </Anchor>
              : B = business, P = personal. Similar transactions follow your lead.
            </List.Item>
            <List.Item icon={<ThemeIcon size={22} radius="xl" variant="light"><IconRobot size={14} /></ThemeIcon>}>
              Tick “Always do this” for merchants that are always the same (airlines, software, your phone bill) so next month sorts itself.
            </List.Item>
          </List>
          <Button component={Link} to="/import" mt="md">
            Import your first file
          </Button>
        </Paper>
      )}

      {data && (
        <Stack gap="lg">
          <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
            <Paper withBorder p="md" component={Link} to="/review" style={{ textDecoration: 'none', color: 'inherit' }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Needs review
              </Text>
              <Text fw={700} fz={26} c={needs ? 'orange' : 'teal'}>
                {needs}
              </Text>
              <Text size="xs" c="dimmed">
                {data.review.suggested} with suggestions · {data.review.reviewed} done
              </Text>
            </Paper>
            <Kpi label={`Business income ${year}`} value={money(data.incomeCents)} color="teal.7" />
            <Kpi label="Deductible expenses" value={money(data.deductibleCents)} hint={`${money(data.expenseCents)} spent; meals counted at 50%`} />
            <Kpi
              label="Net profit (so far)"
              value={money(data.netProfitCents)}
              hint="Before mileage and home office (coming in later updates)"
            />
          </SimpleGrid>

          {data.review.yearNeedsReview > 0 && (
            <Alert color="orange" variant="light" icon={<IconAlertCircle />}>
              {plural(data.review.yearNeedsReview, 'transaction')} from {year} {data.review.yearNeedsReview === 1 ? "isn't" : "aren't"} reviewed yet, so{' '}
              {data.review.yearNeedsReview === 1 ? "it isn't" : "they aren't"} in these totals.{' '}
              <Anchor component={Link} to="/review">
                Review now
              </Anchor>
            </Alert>
          )}
          {data.uncategorizedBusiness > 0 && (
            <Alert color="yellow" variant="light" icon={<IconAlertCircle />}>
              {plural(data.uncategorizedBusiness, 'business transaction')} {data.uncategorizedBusiness === 1 ? 'has' : 'have'} no category.{' '}
              <Anchor component={Link} to="/transactions?classification=business&status=reviewed">
                Find them
              </Anchor>
            </Alert>
          )}

          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Paper withBorder p="md">
              <Text fw={600} mb="sm">
                By category
              </Text>
              {data.categories.length === 0 ? (
                <Text c="dimmed" size="sm">
                  Nothing reviewed as business yet for {year}.
                </Text>
              ) : (
                <Table fz="sm" verticalSpacing={4}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Category</Table.Th>
                      <Table.Th>Form line</Table.Th>
                      <Table.Th ta="right">Total</Table.Th>
                      <Table.Th ta="right">Deductible</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.categories.map((c) => {
                      const line = TAX_LINE_BY_CODE[c.taxLine];
                      return (
                        <Table.Tr key={c.categoryId}>
                          <Table.Td>
                            <Anchor component={Link} to={`/transactions?categoryId=${c.categoryId}&from=${year}-01-01&to=${year}-12-31`} size="sm">
                              {c.name}
                            </Anchor>{' '}
                            <Text span size="xs" c="dimmed">
                              ({c.count})
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" c="dimmed">
                              {line ? `${line.form === 'Tracking' ? '' : line.form + ' '}${line.line !== '—' ? 'line ' + line.line : ''}` : c.taxLine}
                              {!c.countsTowardScheduleC && c.kind === 'expense' && (
                                <Badge ml={4} size="xs" variant="light" color="gray">
                                  not Sch. C
                                </Badge>
                              )}
                            </Text>
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">
                            {money(c.totalCents)}
                          </Table.Td>
                          <Table.Td ta="right" ff="monospace">
                            {c.kind === 'expense' ? money(c.deductibleCents) : ''}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              )}
            </Paper>
            <Paper withBorder p="md">
              <Group justify="space-between" mb="sm">
                <Text fw={600}>By month</Text>
                <Group gap="sm">
                  <Group gap={4}>
                    <div className="month-bar" style={{ width: 12, background: 'var(--mantine-color-teal-5)' }} />
                    <Text size="xs">Income</Text>
                  </Group>
                  <Group gap={4}>
                    <div className="month-bar" style={{ width: 12, background: 'var(--mantine-color-cyan-7)' }} />
                    <Text size="xs">Expenses</Text>
                  </Group>
                </Group>
              </Group>
              <Stack gap={6}>
                {Array.from({ length: 12 }, (_, i) => {
                  const key = `${year}-${String(i + 1).padStart(2, '0')}`;
                  const m = data.monthly.find((x) => x.month === key);
                  return (
                    <Group key={key} gap="xs" wrap="nowrap">
                      <Text size="xs" w={30} c="dimmed">
                        {new Date(year, i, 1).toLocaleString('en-US', { month: 'short' })}
                      </Text>
                      <Stack gap={2} style={{ flex: 1 }}>
                        <div className="month-bar" title={`Income ${money(m?.incomeCents ?? 0)}`} style={{ width: `${((m?.incomeCents ?? 0) / maxMonth) * 100}%`, background: 'var(--mantine-color-teal-5)', minWidth: m?.incomeCents ? 2 : 0 }} />
                        <div className="month-bar" title={`Expenses ${money(m?.expenseCents ?? 0)}`} style={{ width: `${((m?.expenseCents ?? 0) / maxMonth) * 100}%`, background: 'var(--mantine-color-cyan-7)', minWidth: m?.expenseCents ? 2 : 0 }} />
                      </Stack>
                      <Text size="xs" w={90} ta="right" ff="monospace" c="dimmed">
                        {m ? money(m.incomeCents - m.expenseCents) : ''}
                      </Text>
                    </Group>
                  );
                })}
              </Stack>
            </Paper>
          </SimpleGrid>
        </Stack>
      )}
    </>
  );
}
