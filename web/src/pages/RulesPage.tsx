import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconPencil, IconPlayerPlay, IconPlus, IconTrash } from '@tabler/icons-react';
import type { RuleCondition, RuleConditions, RuleField, RuleOp } from '@et/core';
import { useEffect, useState } from 'react';
import { api, type Rule, type Transaction } from '../api';
import { Money, PageHeader } from '../components/bits';
import { CategorySelect } from '../components/CategorySelect';
import { ClientSelect, ContractorSelect } from '../components/PartySelects';
import { shortDate } from '../format';
import { notifyError, useAccountMap, useAccounts, useCategoryMap, useRefreshAll } from '../hooks';

const FIELD_LABEL: Record<RuleField, string> = {
  description: 'Bank description',
  merchant: 'Merchant',
  amount: 'Amount',
  direction: 'Money in/out',
  account: 'Account',
  state: 'State',
  city: 'City',
  date: 'Date',
};

const TEXT_OPS: { value: RuleOp; label: string }[] = [
  { value: 'contains', label: 'contains' },
  { value: 'starts_with', label: 'starts with' },
  { value: 'equals', label: 'is exactly' },
  { value: 'not_contains', label: "doesn't contain" },
  { value: 'in', label: 'is one of (comma separated)' },
  { value: 'regex', label: 'matches pattern (advanced)' },
];
const NUM_OPS: { value: RuleOp; label: string }[] = [
  { value: 'equals', label: 'is exactly' },
  { value: 'gte', label: 'is at least' },
  { value: 'lte', label: 'is at most' },
  { value: 'between', label: 'is between' },
];
const DATE_OPS: { value: RuleOp; label: string }[] = [
  { value: 'equals', label: 'is on' },
  { value: 'gte', label: 'is on or after' },
  { value: 'lte', label: 'is on or before' },
  { value: 'between', label: 'is between' },
];

function opsFor(field: RuleField) {
  if (field === 'amount') return NUM_OPS;
  if (field === 'date') return DATE_OPS;
  if (field === 'direction' || field === 'account') return [{ value: 'equals' as RuleOp, label: 'is' }];
  return TEXT_OPS;
}

function describeCondition(c: RuleCondition, accountName: (id: number) => string): string {
  const field = FIELD_LABEL[c.field].toLowerCase();
  const op = opsFor(c.field).find((o) => o.value === c.op)?.label ?? c.op;
  const fmt = (v: unknown) =>
    c.field === 'amount' ? `$${(Number(v) / 100).toFixed(2)}` : c.field === 'account' ? accountName(Number(v)) : c.field === 'direction' ? (v === 'out' ? 'money out' : 'money in') : `“${v}”`;
  return `${field} ${op} ${fmt(c.value)}${c.op === 'between' ? ` and ${fmt(c.value2)}` : ''}`;
}

export function RulesPage() {
  const { data: rules } = useQuery({ queryKey: ['rules'], queryFn: () => api.get<Rule[]>('/api/rules') });
  const categories = useCategoryMap();
  const accounts = useAccountMap();
  const refresh = useRefreshAll();
  const [editing, setEditing] = useState<Rule | 'new' | null>(null);

  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Partial<Rule> }) => api.patch(`/api/rules/${id}`, body),
    onSuccess: refresh,
    onError: notifyError,
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/api/rules/${id}`), onSuccess: refresh, onError: notifyError });
  const apply = useMutation({
    mutationFn: (id: number) => api.post<{ applied: number }>(`/api/rules/${id}/apply`, { includeReviewed: false }),
    onSuccess: (r) => {
      refresh();
      notifyInfo(`Applied to ${r.applied} undecided transaction${r.applied === 1 ? '' : 's'}`);
    },
    onError: notifyError,
  });

  return (
    <>
      <PageHeader
        title="Rules"
        description="Rules run first on every import. “Delta Air Lines → Travel: airfare”, “Verizon → 60% business”, “anything in Detroit, MI Oct 12–16 → business”. Lower priority numbers run first."
        right={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
            New rule
          </Button>
        }
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={800}>
          <Table verticalSpacing="xs" fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={60}>On</Table.Th>
                <Table.Th>Rule</Table.Th>
                <Table.Th>Does</Table.Th>
                <Table.Th w={80} ta="right">
                  Priority
                </Table.Th>
                <Table.Th w={90} ta="right">
                  Matched
                </Table.Th>
                <Table.Th w={120} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(rules ?? []).map((r) => (
                <Table.Tr key={r.id} style={{ opacity: r.enabled ? 1 : 0.5 }}>
                  <Table.Td>
                    <Switch checked={r.enabled} onChange={(e) => patch.mutate({ id: r.id, body: { enabled: e.currentTarget.checked } })} aria-label="Enabled" />
                  </Table.Td>
                  <Table.Td>
                    <Text fw={500}>{r.name}</Text>
                    <Text size="xs" c="dimmed">
                      When {r.conditions.items.map((c) => describeCondition(c, (id) => accounts.get(id)?.name ?? `account ${id}`)).join(r.conditions.match === 'all' ? ' and ' : ' or ')}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      <Badge variant="light" color={r.actions.classification === 'personal' ? 'gray' : r.actions.classification === 'transfer' ? 'grape' : 'blue'}>
                        {r.actions.classification ?? 'business'}
                        {r.actions.businessPct ? ` ${r.actions.businessPct}%` : ''}
                      </Badge>
                      {r.actions.categoryId && <Text size="xs">{categories.get(r.actions.categoryId)?.name}</Text>}
                      {!r.autoConfirm && (
                        <Badge variant="outline" color="gray" size="xs">
                          suggest only
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                  <Table.Td ta="right">{r.priority}</Table.Td>
                  <Table.Td ta="right">{r.matchCount}</Table.Td>
                  <Table.Td>
                    <Group gap={2} justify="flex-end">
                      <ActionIcon variant="subtle" title="Apply to undecided transactions now" onClick={() => apply.mutate(r.id)}>
                        <IconPlayerPlay size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" title="Edit" onClick={() => setEditing(r)}>
                        <IconPencil size={16} />
                      </ActionIcon>
                      <ActionIcon variant="subtle" color="red" title="Delete" onClick={() => remove.mutate(r.id)}>
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {rules?.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg" size="sm">
                      No rules yet. The quickest way to make one: in Needs Review, tick “Always do this for …”.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {editing && <RuleEditor rule={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function notifyInfo(message: string) {
  notifications.show({ color: 'teal', message });
}

const blankCondition = (): RuleCondition => ({ field: 'description', op: 'contains', value: '' });

function RuleEditor({ rule, onClose }: { rule: Rule | null; onClose: () => void }) {
  const refresh = useRefreshAll();
  const accounts = useAccounts();
  const [name, setName] = useState(rule?.name ?? '');
  const [conditions, setConditions] = useState<RuleConditions>(rule?.conditions ?? { match: 'all', items: [blankCondition()] });
  const [classification, setClassification] = useState(rule?.actions.classification ?? 'business');
  const [categoryId, setCategoryId] = useState<number | null>(rule?.actions.categoryId ?? null);
  const [businessPct, setBusinessPct] = useState<number | string>(rule?.actions.businessPct ?? '');
  const [note, setNote] = useState(rule?.actions.note ?? '');
  const [clientId, setClientId] = useState<number | null>(rule?.actions.clientId ?? null);
  const [contractorId, setContractorId] = useState<number | null>(rule?.actions.contractorId ?? null);
  const [priority, setPriority] = useState<number | string>(rule?.priority ?? 100);
  const [autoConfirm, setAutoConfirm] = useState(rule?.autoConfirm ?? true);
  const [test, setTest] = useState<{ count: number; reviewedCount: number; sample: Transaction[] } | null>(null);

  useEffect(() => setTest(null), [conditions]);

  const body = () => ({
    name: name || 'Untitled rule',
    priority: Number(priority) || 100,
    autoConfirm,
    conditions,
    actions: {
      classification,
      categoryId: classification === 'business' ? categoryId : null,
      businessPct: classification === 'business' && businessPct ? Number(businessPct) : undefined,
      note: note || undefined,
      clientId: classification === 'business' ? clientId ?? undefined : undefined,
      contractorId: classification === 'business' ? contractorId ?? undefined : undefined,
    },
  });

  const runTest = useMutation({
    mutationFn: () => api.post<typeof test>('/api/rules/test', { conditions }),
    onSuccess: setTest,
    onError: notifyError,
  });
  const save = useMutation({
    mutationFn: () => (rule ? api.patch(`/api/rules/${rule.id}`, body()) : api.post('/api/rules', body())),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });

  const setItem = (i: number, patch: Partial<RuleCondition>) =>
    setConditions((c) => ({ ...c, items: c.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) }));

  return (
    <Modal opened onClose={onClose} title={rule ? 'Edit rule' : 'New rule'} size="xl">
      <Stack>
        <TextInput label="Name" placeholder="e.g. Delta → Airfare" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Group gap="xs">
          <Text size="sm" fw={600}>
            When
          </Text>
          <SegmentedControl
            size="xs"
            value={conditions.match}
            onChange={(v) => setConditions((c) => ({ ...c, match: v as 'all' | 'any' }))}
            data={[
              { value: 'all', label: 'all of these' },
              { value: 'any', label: 'any of these' },
            ]}
          />
          <Text size="sm" fw={600}>
            are true
          </Text>
        </Group>
        {conditions.items.map((c, i) => (
          <Group key={i} gap="xs" wrap="nowrap" align="flex-start">
            <Select
              w={160}
              value={c.field}
              data={Object.entries(FIELD_LABEL).map(([value, label]) => ({ value, label }))}
              onChange={(v) => {
                const field = v as RuleField;
                setItem(i, {
                  field,
                  op: opsFor(field)[0].value,
                  value: field === 'direction' ? 'out' : field === 'account' ? (accounts.data?.[0]?.id ?? '') : '',
                  value2: undefined,
                });
              }}
            />
            <Select w={190} value={c.op} data={opsFor(c.field)} onChange={(v) => setItem(i, { op: v as RuleOp })} />
            <ConditionValue c={c} onChange={(patch) => setItem(i, patch)} />
            <ActionIcon
              variant="subtle"
              color="gray"
              mt={6}
              disabled={conditions.items.length === 1}
              onClick={() => setConditions((cs) => ({ ...cs, items: cs.items.filter((_, j) => j !== i) }))}
              aria-label="Remove condition"
            >
              <IconTrash size={16} />
            </ActionIcon>
          </Group>
        ))}
        <Group gap="xs">
          <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setConditions((c) => ({ ...c, items: [...c.items, blankCondition()] }))}>
            Add condition
          </Button>
          <Button size="xs" variant="default" onClick={() => runTest.mutate()} loading={runTest.isPending}>
            Test — what would this match?
          </Button>
        </Group>
        {test && (
          <Alert color={test.count ? 'cyan' : 'gray'} variant="light" p="xs">
            <Text size="sm" mb={4}>
              Matches <b>{test.count}</b> transactions ({test.reviewedCount} already reviewed — those are left alone unless you re-apply).
            </Text>
            {test.sample.slice(0, 8).map((t) => (
              <Group key={t.id} gap="xs" wrap="nowrap">
                <Text size="xs" w={90}>
                  {shortDate(t.date)}
                </Text>
                <Text size="xs" style={{ flex: 1 }} lineClamp={1}>
                  {t.description}
                </Text>
                <Money cents={t.amountCents} size="xs" />
              </Group>
            ))}
          </Alert>
        )}

        <Text size="sm" fw={600}>
          Then
        </Text>
        <Group gap="xs" align="flex-end" wrap="wrap">
          <SegmentedControl
            value={classification}
            onChange={(v) => setClassification(v as typeof classification)}
            data={[
              { value: 'business', label: 'Business' },
              { value: 'personal', label: 'Personal' },
              { value: 'transfer', label: 'Transfer' },
            ]}
          />
          {classification === 'business' && (
            <>
              <CategorySelect w={260} value={categoryId} onChange={setCategoryId} label="Category" />
              <NumberInput w={140} label="Business % (split)" placeholder="100" min={1} max={99} suffix="%" value={businessPct} onChange={setBusinessPct} />
            </>
          )}
        </Group>
        {classification === 'business' && (
          <Group grow>
            <ClientSelect label="Tag client (optional)" value={clientId} onChange={setClientId} />
            <ContractorSelect label="Tag contractor (optional)" value={contractorId} onChange={setContractorId} />
          </Group>
        )}
        <TextInput label="Add a note (optional)" placeholder="e.g. Client lunches" value={note} onChange={(e) => setNote(e.currentTarget.value)} />
        <Group gap="lg">
          <Switch checked={autoConfirm} onChange={(e) => setAutoConfirm(e.currentTarget.checked)} label="Mark as reviewed automatically (off = only suggest)" />
          <NumberInput w={120} label="Priority" min={0} max={10000} value={priority} onChange={setPriority} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save rule
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ConditionValue({ c, onChange }: { c: RuleCondition; onChange: (patch: Partial<RuleCondition>) => void }) {
  const accounts = useAccounts();
  if (c.field === 'direction') {
    return (
      <Select
        style={{ flex: 1 }}
        value={String(c.value)}
        onChange={(v) => onChange({ value: v ?? 'out' })}
        data={[
          { value: 'out', label: 'Money out (purchase)' },
          { value: 'in', label: 'Money in (deposit/refund)' },
        ]}
      />
    );
  }
  if (c.field === 'account') {
    return (
      <Select
        style={{ flex: 1 }}
        value={String(c.value)}
        onChange={(v) => onChange({ value: Number(v) })}
        data={(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
      />
    );
  }
  if (c.field === 'amount') {
    const toCents = (v: number | string) => Math.round(Number(v) * 100);
    return (
      <Group gap="xs" style={{ flex: 1 }} wrap="nowrap">
        <NumberInput prefix="$" decimalScale={2} min={0} value={c.value === '' ? '' : Number(c.value) / 100} onChange={(v) => onChange({ value: toCents(v) })} />
        {c.op === 'between' && (
          <NumberInput prefix="$" decimalScale={2} min={0} value={c.value2 === undefined ? '' : Number(c.value2) / 100} onChange={(v) => onChange({ value2: toCents(v) })} />
        )}
      </Group>
    );
  }
  if (c.field === 'date') {
    return (
      <Group gap="xs" style={{ flex: 1 }} wrap="nowrap">
        <TextInput type="date" value={String(c.value)} onChange={(e) => onChange({ value: e.currentTarget.value })} />
        {c.op === 'between' && <TextInput type="date" value={String(c.value2 ?? '')} onChange={(e) => onChange({ value2: e.currentTarget.value })} />}
      </Group>
    );
  }
  return (
    <TextInput
      style={{ flex: 1 }}
      placeholder={c.field === 'state' ? 'MI' : c.field === 'merchant' ? 'DELTA AIR LINES' : 'text to look for'}
      value={String(c.value)}
      onChange={(e) => onChange({ value: e.currentTarget.value })}
    />
  );
}
