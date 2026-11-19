import { Alert, Badge, Button, Divider, Drawer, Group, SegmentedControl, Stack, Table, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconArrowsSplit, IconRobot, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Rule, type Transaction } from '../api';
import { Anchor } from '@mantine/core';
import { money, shortDate } from '../format';
import { notifyError, useAccountMap, useBulkUpdate, useCategoryMap, useRefreshAll } from '../hooks';
import { ClassBadge, Location, Money, SourceIcon } from './bits';
import { CategorySelect } from './CategorySelect';
import { SplitEditor, type SplitLineInput } from './SplitEditor';

export function useCreateRuleFromTransaction() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (transactionId: number) =>
      api.post<{ rule: Rule; applied: number; updatedExisting: boolean }>('/api/rules/from-transaction', { transactionId }),
    onSuccess: (r) => {
      refresh();
      notifications.show({
        color: 'teal',
        title: r.updatedExisting ? 'Rule updated' : 'Rule created',
        message: `“${r.rule.name}”${r.applied ? ` — applied to ${r.applied} other transaction${r.applied === 1 ? '' : 's'}` : ''}`,
      });
    },
    onError: notifyError,
  });
}

export function TransactionDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: t } = useQuery({
    queryKey: ['transactions', 'one', id],
    queryFn: () => api.get<Transaction>(`/api/transactions/${id}`),
    enabled: id !== null,
  });
  const accounts = useAccountMap();
  const categories = useCategoryMap();
  const bulk = useBulkUpdate();
  const refresh = useRefreshAll();
  const createRule = useCreateRuleFromTransaction();
  const rulesQ = useQuery({ queryKey: ['rules'], queryFn: () => api.get<Rule[]>('/api/rules'), enabled: id !== null });
  const ruleName = t?.ruleId ? rulesQ.data?.find((r) => r.id === t.ruleId)?.name ?? 'a rule' : null;
  const deleteRule = useMutation({
    mutationFn: (ruleId: number) => api.del(`/api/rules/${ruleId}`),
    onSuccess: () => {
      refresh();
      notifications.show({ color: 'gray', message: 'Rule deleted. Transactions it already sorted keep their categories.' });
    },
    onError: notifyError,
  });
  const ignoreRule = useMutation({
    mutationFn: (ruleId: number) => api.post<Transaction>(`/api/transactions/${id}/ignore-rule`, { ruleId }),
    onSuccess: () => {
      refresh();
      notifications.show({ color: 'gray', message: 'Rule skipped for this transaction. It is back to Needs Review or a suggestion.' });
    },
    onError: notifyError,
  });
  const [notes, setNotes] = useState('');
  const [splitting, setSplitting] = useState(false);

  useEffect(() => {
    setNotes(t?.notes ?? '');
    setSplitting(false);
  }, [t?.id, t?.notes]);

  const saveSplits = useMutation({
    mutationFn: (splits: SplitLineInput[]) => api.put<Transaction>(`/api/transactions/${id}/splits`, { splits }),
    onSuccess: () => {
      setSplitting(false);
      refresh();
    },
    onError: notifyError,
  });
  const removeSplits = useMutation({
    mutationFn: () => api.del<Transaction>(`/api/transactions/${id}/splits`),
    onSuccess: refresh,
    onError: notifyError,
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/transactions/${id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });

  const account = t ? accounts.get(t.accountId) : undefined;

  return (
    <Drawer opened={id !== null} onClose={onClose} position="right" size="lg" title={<Text fw={700}>Transaction</Text>}>
      {t && (
        <Stack gap="md">
          <div>
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={700} fz="xl">
                  {t.merchant}
                </Text>
                <Text size="sm" c="dimmed">
                  {shortDate(t.date)} · {account?.name ?? 'Account'} <Location t={t} />
                </Text>
              </div>
              <Money cents={t.amountCents} fz="xl" fw={700} />
            </Group>
            <Text size="xs" c="dimmed" mt={6} ff="monospace" style={{ wordBreak: 'break-word' }}>
              {t.description}
              {t.memo ? ` — ${t.memo}` : ''}
              {t.checkNumber ? ` (check #${t.checkNumber})` : ''}
            </Text>
            <Group gap="xs" mt="xs">
              <ClassBadge t={t} />
              <SourceIcon source={t.source} confidence={t.confidence} />
              {t.tripId && (
                <Badge variant="light" color="cyan" tt="none" component={Link} to={`/trips/${t.tripId}`} style={{ cursor: 'pointer' }} onClick={onClose}>
                  {t.status === 'reviewed' ? 'On a business trip' : 'Suggested for a business trip'} →
                </Badge>
              )}
              {ruleName && t.ruleId && (
                <Badge variant="light" color="grape" tt="none">
                  Set by rule: {ruleName}
                </Badge>
              )}
              {t.transferPairId && (
                <Badge variant="light" color="grape">
                  matched transfer
                </Badge>
              )}
            </Group>
          </div>

          {!t.isSplit && (
            <Stack gap="xs">
              <SegmentedControl
                fullWidth
                value={t.classification ?? ''}
                onChange={(v) => bulk.mutate({ ids: [t.id], classification: v as 'business', quiet: true })}
                data={[
                  { value: 'business', label: 'Business' },
                  { value: 'personal', label: 'Personal' },
                  { value: 'transfer', label: 'Transfer' },
                ]}
              />
              {t.classification !== 'personal' && t.classification !== 'transfer' && (
                <CategorySelect
                  label={t.classification === 'business' ? 'Category' : 'Category (choosing one marks it business)'}
                  value={t.categoryId}
                  incomeFirst={t.amountCents > 0}
                  onChange={(cid) => bulk.mutate({ ids: [t.id], categoryId: cid, quiet: true })}
                />
              )}
              {t.status !== 'reviewed' && t.classification && (
                <Button variant="light" onClick={() => bulk.mutate({ ids: [t.id], approve: true, quiet: true })}>
                  Approve suggestion
                </Button>
              )}
              {t.classification && t.status === 'reviewed' && (
                <Button
                  variant="subtle"
                  leftSection={<IconRobot size={16} />}
                  loading={createRule.isPending}
                  onClick={() => createRule.mutate(t.id)}
                >
                  Always do this for “{t.merchant}”
                </Button>
              )}
            </Stack>
          )}

          <Divider label="Split" labelPosition="left" />
          {t.isSplit && !splitting && (
            <Stack gap="xs">
              <Table>
                <Table.Tbody>
                  {t.splits.map((s) => (
                    <Table.Tr key={s.id}>
                      <Table.Td>
                        <Money cents={s.amountCents} />
                      </Table.Td>
                      <Table.Td>{s.classification}</Table.Td>
                      <Table.Td>{s.categoryId ? categories.get(s.categoryId)?.name : '—'}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
              <Group gap="xs">
                <Button size="xs" variant="default" onClick={() => setSplitting(true)}>
                  Edit split
                </Button>
                <Button size="xs" variant="subtle" color="red" onClick={() => removeSplits.mutate()}>
                  Remove split
                </Button>
              </Group>
            </Stack>
          )}
          {!t.isSplit && !splitting && (
            <Button
              variant="default"
              leftSection={<IconArrowsSplit size={16} />}
              onClick={() => setSplitting(true)}
              w="fit-content"
            >
              Split business / personal
            </Button>
          )}
          {splitting && (
            <SplitEditor t={t} saving={saveSplits.isPending} onCancel={() => setSplitting(false)} onSave={(l) => saveSplits.mutate(l)} />
          )}

          <Divider label="Notes" labelPosition="left" />
          <Textarea
            placeholder="Business purpose, who you met, what it was for… (useful if you're ever audited)"
            autosize
            minRows={2}
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            onBlur={() => {
              if ((t.notes ?? '') !== notes) bulk.mutate({ ids: [t.id], notes, quiet: true });
            }}
          />

          {t.batchId === null && (
            <>
              <Divider />
              <Alert color="gray" variant="light">
                <Group justify="space-between">
                  <Text size="sm">Entered by hand (not from a bank file).</Text>
                  <Button size="xs" color="red" variant="subtle" leftSection={<IconTrash size={14} />} onClick={() => del.mutate()}>
                    Delete
                  </Button>
                </Group>
              </Alert>
            </>
          )}
          <Text size="xs" c="dimmed">
            Amount {money(t.amountCents)} · {t.amountCents < 0 ? 'money out' : 'money in'}
          </Text>

          {t.ruleId && (
            <Alert color="grape" variant="light" title="This transaction was sorted by a rule">
              <Stack gap="xs">
                <Text size="sm">Rule: {ruleName}</Text>
                <Group gap="xs">
                  <Anchor component={Link} to="/rules" size="sm" onClick={onClose}>
                    Open rules to edit
                  </Anchor>
                </Group>
                <Group gap="xs">
                  <Button size="xs" variant="default" loading={ignoreRule.isPending} onClick={() => ignoreRule.mutate(t.ruleId!)}>
                    Ignore rule for this transaction
                  </Button>
                  <Button
                    size="xs"
                    color="red"
                    variant="subtle"
                    loading={deleteRule.isPending}
                    onClick={() => {
                      if (window.confirm(`Delete the rule “${ruleName}”? Transactions it already sorted keep their categories.`)) deleteRule.mutate(t.ruleId!);
                    }}
                  >
                    Delete rule
                  </Button>
                </Group>
              </Stack>
            </Alert>
          )}

          <Button
            size="md"
            fullWidth
            mt="sm"
            onClick={() => {
              if ((t.notes ?? '') !== notes) bulk.mutate({ ids: [t.id], notes, quiet: true });
              onClose();
            }}
          >
            Save and close
          </Button>
        </Stack>
      )}
    </Drawer>
  );
}
