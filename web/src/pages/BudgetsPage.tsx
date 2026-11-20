import { ActionIcon, Alert, Badge, Button, Group, NumberInput, Paper, Progress, SegmentedControl, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { api, type BudgetsResponse } from '../api';
import { PageHeader } from '../components/bits';
import { CategorySelect } from '../components/CategorySelect';
import { money } from '../format';
import { notifyError } from '../hooks';

const STATUS: Record<string, [string, string]> = { ok: ['On track', 'teal'], warning: ['Watch it', 'orange'], over: ['Over budget', 'red'] };

export function BudgetsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, refetch } = useQuery({ queryKey: ['budgets', month], queryFn: () => api.get<BudgetsResponse>(`/api/budgets?month=${month}`) });
  const [scope, setScope] = useState<'category' | 'business_total' | 'personal_total'>('category');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [amount, setAmount] = useState<number | string>('');
  const save = useMutation({
    mutationFn: (b: { scope: string; categoryId?: number | null; monthlyCents: number }) => api.put('/api/budgets', b),
    onSuccess: () => {
      setAmount('');
      void refetch();
    },
    onError: notifyError,
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/budgets/${id}`), onSuccess: () => void refetch() });

  return (
    <>
      <PageHeader
        title="Budgets"
        description="Monthly limits for business categories (or all business / all personal spending). The bar shows spent so far; the pace check warns you before you go over."
        right={<TextInput type="month" value={month} onChange={(e) => e.currentTarget.value && setMonth(e.currentTarget.value)} />}
      />
      {data && (
        <Stack>
          {data.unreviewed > 0 && (
            <Alert color="yellow" variant="light" p="xs">
              <Text size="sm">{data.unreviewed} transactions this month aren't reviewed yet, so they aren't counted.</Text>
            </Alert>
          )}
          <Paper withBorder p="md">
            {data.budgets.length === 0 && <Text size="sm" c="dimmed">No budgets yet — add one below.</Text>}
            <Stack gap="md">
              {data.budgets.map((b) => (
                <div key={b.id}>
                  <Group justify="space-between" mb={4}>
                    <Group gap="xs">
                      <Text fw={500}>{b.name}</Text>
                      <Badge color={STATUS[b.status][1]} variant="light">{STATUS[b.status][0]}</Badge>
                    </Group>
                    <Group gap="xs">
                      <Text size="sm" ff="monospace">
                        {money(b.spentCents)} of {money(b.budgetCents)}
                      </Text>
                      <ActionIcon variant="subtle" color="gray" onClick={() => del.mutate(b.id)} aria-label="Delete budget"><IconTrash size={14} /></ActionIcon>
                    </Group>
                  </Group>
                  <Progress value={Math.min(100, b.pct)} color={STATUS[b.status][1]} size="lg" />
                  <Text size="xs" c="dimmed" mt={2}>
                    {b.pct}% used · on pace for {money(b.projectedCents)} this month
                  </Text>
                </div>
              ))}
            </Stack>
          </Paper>

          <Paper withBorder p="md">
            <Title order={5} mb="xs">Add or change a budget</Title>
            <Group align="flex-end" gap="xs" wrap="wrap">
              <SegmentedControl
                value={scope}
                onChange={(v) => setScope(v as typeof scope)}
                data={[
                  { value: 'category', label: 'One category' },
                  { value: 'business_total', label: 'All business' },
                  { value: 'personal_total', label: 'All personal' },
                ]}
              />
              {scope === 'category' && <CategorySelect w={260} value={categoryId} onChange={setCategoryId} />}
              <NumberInput w={140} prefix="$" thousandSeparator placeholder="Per month" value={amount} onChange={setAmount} />
              <Button
                disabled={!amount || (scope === 'category' && !categoryId)}
                onClick={() => save.mutate({ scope, categoryId: scope === 'category' ? categoryId : null, monthlyCents: Math.round(Number(amount) * 100) })}
              >
                Save budget
              </Button>
            </Group>
          </Paper>

          {data.typical.length > 0 && (
            <Paper withBorder p="md">
              <Title order={5} mb={4}>What you usually spend</Title>
              <Text size="xs" c="dimmed" mb="xs">Average per month over the last 3 months — a starting point for budgets.</Text>
              <Table fz="sm" verticalSpacing={4}>
                <Table.Tbody>
                  {data.typical.map((t) => (
                    <Table.Tr key={t.categoryId}>
                      <Table.Td>{t.name}</Table.Td>
                      <Table.Td ta="right" ff="monospace">{money(t.avgMonthlyCents)}/mo</Table.Td>
                      <Table.Td w={140}>
                        <Button size="compact-xs" variant="subtle" onClick={() => save.mutate({ scope: 'category', categoryId: t.categoryId, monthlyCents: Math.ceil(t.avgMonthlyCents / 1000) * 1000 })}>
                          Use as budget
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}
        </Stack>
      )}
    </>
  );
}
