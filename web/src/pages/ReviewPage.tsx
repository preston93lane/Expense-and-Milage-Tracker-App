import { Alert, Badge, Button, Card, Checkbox, Group, Paper, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import { IconCheck, IconConfetti, IconListDetails } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs, type Transaction, type TransactionList } from '../api';
import { Kbd, Location, Money, PageHeader, SourceIcon } from '../components/bits';
import { CategorySelect } from '../components/CategorySelect';
import { TransactionDrawer, useCreateRuleFromTransaction } from '../components/TransactionDrawer';
import { plural, shortDate } from '../format';
import { lastAction, useAccountMap, useBulkUpdate, useCategories, useCategoryMap, useUndo } from '../hooks';

const DEFAULT_QUICK = ['travel_airfare', 'travel_lodging', 'travel_car', 'travel_meals', 'meals', 'software', 'office', 'supplies', 'income'];

const SOURCE_TEXT: Record<string, string> = {
  history: 'how you handled this merchant before',
  keyword: 'built-in merchant knowledge',
  transfer: 'looks like a card payment / transfer',
  rule: 'one of your rules',
  import: 'your imported history',
  trip: 'it falls inside one of your business trips',
};

export function ReviewPage() {
  const [order, setOrder] = useState<'date_desc' | 'merchant'>('merchant');
  const { data, isLoading } = useQuery({
    queryKey: ['transactions', 'review', order],
    queryFn: () => api.get<TransactionList>(`/api/transactions${qs({ status: 'needs_review', limit: 1000, sort: order })}`),
  });
  const accounts = useAccountMap();
  const categoriesQ = useCategories();
  const categoryMap = useCategoryMap();
  const bulk = useBulkUpdate();
  const undo = useUndo();
  const createRule = useCreateRuleFromTransaction();

  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [category, setCategory] = useState<number | null>(null);
  const [applyToSame, setApplyToSame] = useState(true);
  const [remember, setRemember] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);

  const rows = data?.rows ?? [];
  const queue = rows.filter((r) => !skipped.has(r.id));
  const current: Transaction | undefined = queue[0];
  const sameMerchant = useMemo(
    () => (current ? rows.filter((r) => r.merchantKey === current.merchantKey && r.id !== current.id) : []),
    [rows, current],
  );
  const suggestedCount = rows.filter((r) => r.status === 'suggested').length;

  // Quick-pick categories: the ones you use most, topped up with common ones.
  const quick = useMemo(() => {
    const all = (categoriesQ.data ?? []).filter((c) => !c.archived && c.kind !== 'other');
    const used = [...all].filter((c) => (c.usageCount ?? 0) > 0).sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
    const defaults = DEFAULT_QUICK.map((k) => all.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c);
    const out: typeof all = [];
    for (const c of [...used, ...defaults]) if (!out.some((o) => o.id === c.id)) out.push(c);
    return out.slice(0, 9);
  }, [categoriesQ.data]);

  useEffect(() => {
    setCategory(current?.categoryId ?? null);
    setRemember(false);
  }, [current?.id, current?.categoryId]);

  const ids = () => (current ? [current.id, ...(applyToSame ? sameMerchant.map((r) => r.id) : [])] : []);

  const decide = (change: { classification?: 'business' | 'personal' | 'transfer'; categoryId?: number | null; approve?: boolean }) => {
    if (!current) return;
    const tx = current;
    bulk.mutate(
      { ids: ids(), ...change },
      {
        onSuccess: () => {
          if (remember && !change.approve) createRule.mutate(tx.id);
        },
      },
    );
  };

  const business = (catId = category) =>
    decide(catId ? { classification: 'business', categoryId: catId } : { classification: 'business' });

  useHotkeys([
    ['b', () => business()],
    ['p', () => decide({ classification: 'personal' })],
    ['t', () => decide({ classification: 'transfer' })],
    ['a', () => current?.classification && decide({ approve: true })],
    ['s', () => current && setSkipped((s) => new Set(s).add(current.id))],
    ['u', () => lastAction.id && undo.mutate(lastAction.id)],
    ['r', () => setRemember((v) => !v)],
    ...quick.map((c, i) => [String(i + 1), () => business(c.id)] as [string, () => void]),
  ]);

  return (
    <>
      <PageHeader
        title="Needs Review"
        description="Anything the app couldn't decide on its own lands here. Decide once per merchant — similar transactions follow, and rules make it automatic next month."
        right={
          <Group gap="xs">
            <SegmentedControl
              size="xs"
              value={order}
              onChange={(v) => setOrder(v as typeof order)}
              data={[
                { value: 'merchant', label: 'Group by merchant' },
                { value: 'date_desc', label: 'Newest first' },
              ]}
            />
            <Button component={Link} to="/transactions?status=needs_review" variant="default" size="xs" leftSection={<IconListDetails size={14} />}>
              Open as list
            </Button>
          </Group>
        }
      />

      {suggestedCount > 0 && (
        <Alert color="cyan" variant="light" mb="md">
          <Group justify="space-between">
            <Text size="sm">
              <b>{plural(suggestedCount, 'transaction')}</b> {suggestedCount === 1 ? 'has' : 'have'} a suggestion (from your history, transfers or rules set to “suggest only”).
            </Text>
            <Group gap="xs">
              <Button size="xs" component={Link} to="/transactions?status=suggested" variant="default">
                Look them over
              </Button>
              <Button size="xs" leftSection={<IconCheck size={14} />} onClick={() => bulk.mutate({ filters: { status: 'suggested' }, approve: true })}>
                Approve all {suggestedCount}
              </Button>
            </Group>
          </Group>
        </Alert>
      )}

      {isLoading ? (
        <Text c="dimmed">Loading…</Text>
      ) : !current ? (
        <Paper withBorder p="xl" ta="center">
          <IconConfetti size={40} color="var(--mantine-color-teal-6)" />
          <Title order={3} mt="sm">
            All caught up
          </Title>
          <Text c="dimmed" mt="xs">
            {skipped.size ? `${skipped.size} skipped for now. ` : ''}Import next month's bank files when you're ready.
          </Text>
          {skipped.size > 0 && (
            <Button mt="md" variant="default" onClick={() => setSkipped(new Set())}>
              Show skipped again
            </Button>
          )}
        </Paper>
      ) : (
        <Stack gap="md" maw={820}>
          <Text size="sm" c="dimmed">
            {queue.length} left{skipped.size ? ` · ${skipped.size} skipped` : ''}
          </Text>
          <Card withBorder padding="lg" radius="md" shadow="sm">
            <Group justify="space-between" align="flex-start">
              <div>
                <Group gap="xs">
                  <Text fw={700} fz={22}>
                    {current.merchant}
                  </Text>
                  <SourceIcon source={current.source} confidence={current.confidence} />
                </Group>
                <Text size="sm" c="dimmed">
                  {shortDate(current.date)} · {accounts.get(current.accountId)?.name} <Location t={current} />
                </Text>
              </div>
              <Money cents={current.amountCents} fz={24} fw={700} />
            </Group>
            <Text size="xs" c="dimmed" ff="monospace" mt="xs" style={{ wordBreak: 'break-word' }}>
              {current.description}
            </Text>

            {current.source && current.source !== 'manual' && (current.classification || current.categoryId) && (
              <Alert variant="light" color={current.status === 'suggested' ? 'cyan' : 'gray'} mt="md" p="xs">
                <Group justify="space-between">
                  <Text size="sm">
                    {current.classification ? (
                      <>
                        Suggested: <b>{current.classification}</b>
                        {current.categoryId ? <> · {categoryMap.get(current.categoryId)?.name}</> : null}
                      </>
                    ) : (
                      <>If business, probably: <b>{categoryMap.get(current.categoryId!)?.name}</b></>
                    )}
                    <Text span c="dimmed" size="xs">
                      {' '}
                      — {SOURCE_TEXT[current.source] ?? current.source}
                    </Text>
                  </Text>
                  {current.classification && (
                    <Button size="xs" onClick={() => decide({ approve: true })} rightSection={<Kbd>A</Kbd>}>
                      Approve
                    </Button>
                  )}
                </Group>
              </Alert>
            )}

            <Group mt="md" gap="xs" align="flex-end" wrap="wrap">
              <CategorySelect
                label="Category (if business)"
                w={300}
                value={category}
                onChange={setCategory}
                incomeFirst={current.amountCents > 0}
              />
              <Button onClick={() => business()} rightSection={<Kbd>B</Kbd>}>
                Business
              </Button>
              <Button variant="default" onClick={() => decide({ classification: 'personal' })} rightSection={<Kbd>P</Kbd>}>
                Personal
              </Button>
              <Button variant="default" onClick={() => decide({ classification: 'transfer' })} rightSection={<Kbd>T</Kbd>}>
                Transfer
              </Button>
              <Button variant="subtle" color="gray" onClick={() => setSkipped((s) => new Set(s).add(current.id))} rightSection={<Kbd>S</Kbd>}>
                Skip
              </Button>
              <Button variant="subtle" color="gray" onClick={() => setDrawerId(current.id)}>
                Details / split
              </Button>
            </Group>

            <Group mt="md" gap="lg">
              {sameMerchant.length > 0 && (
                <Checkbox
                  checked={applyToSame}
                  onChange={(e) => setApplyToSame(e.currentTarget.checked)}
                  label={`Also apply to ${sameMerchant.length} other ${current.merchant} transaction${sameMerchant.length === 1 ? '' : 's'} waiting here`}
                />
              )}
              <Checkbox
                checked={remember}
                onChange={(e) => setRemember(e.currentTarget.checked)}
                label={
                  <>
                    Always do this for {current.merchant} (create a rule) <Kbd>R</Kbd>
                  </>
                }
              />
            </Group>
          </Card>

          {quick.length > 0 && (
            <Paper withBorder p="sm">
              <Text size="xs" c="dimmed" mb={6}>
                Quick business categories (press the number):
              </Text>
              <Group gap={6}>
                {quick.map((c, i) => (
                  <Button key={c.id} size="compact-sm" variant="default" onClick={() => business(c.id)} leftSection={<Kbd>{String(i + 1)}</Kbd>}>
                    {c.name}
                  </Button>
                ))}
              </Group>
            </Paper>
          )}

          <Group gap="md">
            <Text size="xs" c="dimmed">
              <Kbd>U</Kbd> undo last change
            </Text>
            {queue.slice(1, 6).length > 0 && (
              <Text size="xs" c="dimmed">
                Up next:{' '}
                {queue.slice(1, 6).map((q) => (
                  <Badge key={q.id} variant="outline" color="gray" mr={4} tt="none">
                    {q.merchant}
                  </Badge>
                ))}
              </Text>
            )}
          </Group>
        </Stack>
      )}
      <TransactionDrawer id={drawerId} onClose={() => setDrawerId(null)} />
    </>
  );
}
