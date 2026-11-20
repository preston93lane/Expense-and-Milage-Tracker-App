import { Alert, Anchor, Badge, Button, Group, NumberInput, Paper, Progress, Select, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconFileInvoice, IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type IncomeSummary } from '../api';
import { PageHeader } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

interface Client1099s {
  year: number;
  thresholdCents: number;
  rows: { clientId: number; name: string; directCents: number; processorCents: number; expect1099Nec: boolean; viaProcessor: boolean }[];
}

export const RETAINER_STATUS_COLOR: Record<string, string> = { received: 'teal', upcoming: 'gray', late: 'orange', missed: 'red' };

export function IncomePage() {
  const [year, setYear] = useState(new Date().getFullYear());
  const refresh = useRefreshAll();
  const { data } = useQuery({ queryKey: ['income', year], queryFn: () => api.get<IncomeSummary>(`/api/income/summary?year=${year}`) });
  const c1099 = useQuery({ queryKey: ['reports', 'client-1099s', year], queryFn: () => api.get<Client1099s>(`/api/reports/client-1099s?year=${year}`) });
  const [goal, setGoal] = useState<number | string>('');
  const saveGoal = useMutation({
    mutationFn: () => api.put(`/api/income/goal/${year}`, { amountCents: Math.round(Number(goal) * 100) }),
    onSuccess: () => {
      setGoal('');
      refresh();
    },
    onError: notifyError,
  });
  const years = Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i));
  const maxMonth = Math.max(1, ...(data?.monthly ?? []).map((m) => m.incomeCents));
  const pct = data?.goalCents ? Math.min(100, (data.incomeCents / data.goalCents) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Income"
        description="Money coming in: client payments, invoices you're owed, and retainers you're expecting. Tag deposits with a client (in Needs Review or Transactions) and it all adds up here."
        right={
          <Group>
            <Button component={Link} to="/invoices/new" leftSection={<IconFileInvoice size={16} />}>
              New invoice
            </Button>
            <Button component={Link} to="/clients" variant="default" leftSection={<IconUsers size={16} />}>
              Clients
            </Button>
            <Select w={100} value={String(year)} onChange={(v) => v && setYear(Number(v))} data={years} aria-label="Year" />
          </Group>
        }
      />
      {data && (
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }}>
            <Paper withBorder p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Business income {year}
              </Text>
              <Text fw={700} fz={26} ff="monospace" c="teal.7">
                {money(data.incomeCents)}
              </Text>
              {data.projectedCents ? (
                <Text size="xs" c="dimmed">
                  On pace for {money(data.projectedCents)} this year
                </Text>
              ) : null}
            </Paper>
            <Paper withBorder p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Goal
              </Text>
              {data.goalCents ? (
                <>
                  <Text fw={700} fz={26} ff="monospace">
                    {Math.round(pct)}%
                  </Text>
                  <Progress value={pct} color="teal" mt={4} />
                  <Text size="xs" c="dimmed" mt={4}>
                    of {money(data.goalCents)} · {money(Math.max(0, data.goalCents - data.incomeCents))} to go
                  </Text>
                </>
              ) : (
                <Text size="sm" c="dimmed" mt="xs">
                  No goal set for {year}
                </Text>
              )}
              <Group gap={4} mt="xs">
                <NumberInput size="xs" placeholder="Set goal" prefix="$" thousandSeparator min={0} value={goal} onChange={setGoal} w={130} />
                <Button size="xs" variant="default" disabled={!goal} onClick={() => saveGoal.mutate()}>
                  Save
                </Button>
              </Group>
            </Paper>
            <Paper withBorder p="md" component={Link} to="/invoices?state=unpaid" style={{ textDecoration: 'none', color: 'inherit' }}>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Owed to you
              </Text>
              <Text fw={700} fz={26} ff="monospace">
                {money(data.outstandingCents)}
              </Text>
              {data.overdueCount > 0 && (
                <Text size="xs" c="red">
                  {money(data.overdueCents)} overdue ({data.overdueCount})
                </Text>
              )}
            </Paper>
            <Paper withBorder p="md">
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Expected next 30 days
              </Text>
              <Text fw={700} fz={26} ff="monospace">
                {money(data.expectedNext30Cents)}
              </Text>
              <Text size="xs" c="dimmed">
                Retainers + invoices coming due
              </Text>
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }}>
            <Paper withBorder p="md">
              <Text fw={600} mb="sm">
                By client
              </Text>
              <Table fz="sm" verticalSpacing={4}>
                <Table.Tbody>
                  {data.byClient.map((c) => (
                    <Table.Tr key={String(c.clientId)}>
                      <Table.Td>
                        {c.clientId ? (
                          <Anchor component={Link} to={`/clients/${c.clientId}`} size="sm">
                            {c.name}
                          </Anchor>
                        ) : (
                          <Anchor component={Link} to={`/transactions?direction=in&classification=business&from=${year}-01-01&to=${year}-12-31`} size="sm" c="orange">
                            {c.name} — tag these
                          </Anchor>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {money(c.incomeCents)}
                      </Table.Td>
                      <Table.Td w={80} ta="right" c="dimmed">
                        {data.incomeCents ? `${Math.round((c.incomeCents / data.incomeCents) * 100)}%` : ''}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                  {data.byClient.length === 0 && (
                    <Table.Tr>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          No business income reviewed for {year} yet.
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Table.Tbody>
              </Table>
            </Paper>
            <Paper withBorder p="md">
              <Text fw={600} mb="sm">
                By month
              </Text>
              <Stack gap={6}>
                {data.monthly.map((m, i) => (
                  <Group key={m.month} gap="xs" wrap="nowrap">
                    <Text size="xs" w={30} c="dimmed">
                      {new Date(year, i, 1).toLocaleString('en-US', { month: 'short' })}
                    </Text>
                    <div style={{ flex: 1 }}>
                      <div className="month-bar" style={{ width: `${(m.incomeCents / maxMonth) * 100}%`, background: 'var(--mantine-color-teal-5)', minWidth: m.incomeCents ? 2 : 0 }} />
                    </div>
                    <Text size="xs" w={90} ta="right" ff="monospace" c="dimmed">
                      {m.incomeCents ? money(m.incomeCents) : ''}
                    </Text>
                  </Group>
                ))}
              </Stack>
            </Paper>
          </SimpleGrid>

          {data.upcomingRetainers.length > 0 && (
            <Paper withBorder p="md">
              <Text fw={600} mb="xs">
                Retainer payments due soon
              </Text>
              <Table fz="sm">
                <Table.Tbody>
                  {data.upcomingRetainers.map((e) => (
                    <Table.Tr key={`${e.retainerId}-${e.dueDate}`}>
                      <Table.Td>{shortDate(e.dueDate)}</Table.Td>
                      <Table.Td>
                        <Anchor component={Link} to={`/clients/${e.clientId}`} size="sm">
                          {e.clientName}
                        </Anchor>{' '}
                        · {e.name}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {money(e.amountCents)}
                      </Table.Td>
                      <Table.Td>
                        <Badge color={RETAINER_STATUS_COLOR[e.status]} variant="light">
                          {e.status}
                        </Badge>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          {c1099.data && c1099.data.rows.length > 0 && (
            <Paper withBorder p="md">
              <Title order={5}>1099s you may receive for {year}</Title>
              <Text size="sm" c="dimmed" mb="xs">
                Clients who paid you {money(c1099.data.thresholdCents)} or more directly (check, ACH, Zelle) should send you a 1099-NEC by
                early February. Card/PayPal/Stripe payments are reported by the processor on a 1099-K instead (only above $20,000 and 200
                payments). Your income is taxable either way — these are just for cross-checking.
              </Text>
              <Table fz="sm">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Client</Table.Th>
                    <Table.Th ta="right">Direct</Table.Th>
                    <Table.Th ta="right">Via processor</Table.Th>
                    <Table.Th>Expect</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {c1099.data.rows.map((r) => (
                    <Table.Tr key={r.clientId}>
                      <Table.Td>{r.name}</Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {money(r.directCents)}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {money(r.processorCents)}
                      </Table.Td>
                      <Table.Td>
                        {r.expect1099Nec && <Badge variant="light">1099-NEC</Badge>} {r.viaProcessor && <Badge variant="light" color="gray">maybe 1099-K</Badge>}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}
          <Alert variant="light" color="gray">
            Tip: create a rule like “ACME CORP → Business income, client Acme” (Rules page) so client deposits sort themselves.
          </Alert>
        </Stack>
      )}
    </>
  );
}
