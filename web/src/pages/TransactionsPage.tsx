import {
  Button,
  Checkbox,
  Group,
  Menu,
  Modal,
  NumberInput,
  Pagination,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { DatePickerInput, DateInput } from '@mantine/dates';
import { useDebouncedValue, useDisclosure } from '@mantine/hooks';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconCalendar, IconChevronDown, IconPlus, IconSearch, IconX } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs, type Transaction, type TransactionList } from '../api';
import { ClassBadge, Location, Money, PageHeader, SourceIcon } from '../components/bits';
import { CategorySelect } from '../components/CategorySelect';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { datePresets, money, shortDate, toIso } from '../format';
import { notifyError, useAccountMap, useAccounts, useBulkUpdate, useCategoryMap, useRefreshAll } from '../hooks';

const PAGE = 200;

export function TransactionsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [debounced] = useDebouncedValue(search, 250);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatching, setAllMatching] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [manualOpen, manual] = useDisclosure(false);

  const filters = {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    accountId: params.get('accountId') ?? '',
    status: params.get('status') ?? '',
    classification: params.get('classification') ?? '',
    categoryId: params.get('categoryId') ?? '',
    direction: params.get('direction') ?? '',
    q: debounced,
  };
  const setFilter = (k: string, v: string | null | undefined) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setPage(1);
    setSelected(new Set());
    setAllMatching(false);
  }, [params, debounced]);

  const { data, isFetching } = useQuery({
    queryKey: ['transactions', filters, page],
    queryFn: () => api.get<TransactionList>(`/api/transactions${qs({ ...filters, limit: PAGE, offset: (page - 1) * PAGE })}`),
    placeholderData: (prev) => prev,
  });
  const accounts = useAccounts();
  const accountMap = useAccountMap();
  const categories = useCategoryMap();
  const bulk = useBulkUpdate();

  const rows = data?.rows ?? [];
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const selCount = allMatching ? data?.total ?? 0 : selected.size;

  const target = () =>
    allMatching ? { filters: { ...filters } } : { ids: [...selected] };
  const act = (change: Parameters<typeof bulk.mutate>[0]) =>
    bulk.mutate({ ...target(), ...change }, { onSuccess: () => { setSelected(new Set()); setAllMatching(false); } });

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      setAllMatching(false);
      return n;
    });

  const range: [string | null, string | null] = [filters.from || null, filters.to || null];

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Everything from your bank files. Pick a date range (e.g. a work trip) and act on all of it at once."
        right={
          <Button leftSection={<IconPlus size={16} />} variant="default" onClick={manual.open}>
            Add cash / manual
          </Button>
        }
      />

      <Paper withBorder p="sm" mb="sm">
        <Group gap="xs" wrap="wrap" align="flex-end">
          <DatePickerInput
            type="range"
            label="Dates"
            placeholder="Any date"
            leftSection={<IconCalendar size={16} />}
            value={range}
            onChange={(v) => {
              const next = new URLSearchParams(params);
              const [a, b] = v as [string | Date | null, string | Date | null];
              if (a) next.set('from', toIso(a)!);
              else next.delete('from');
              if (b) next.set('to', toIso(b)!);
              else next.delete('to');
              setParams(next, { replace: true });
            }}
            clearable
            allowSingleDateInRange
            w={250}
            presets={datePresets().map((p) => ({ label: p.label, value: [p.from, p.to] as [string, string] }))}
          />
          <Select
            label="Account"
            placeholder="All accounts"
            clearable
            w={180}
            value={filters.accountId || null}
            onChange={(v) => setFilter('accountId', v)}
            data={(accounts.data ?? []).map((a) => ({ value: String(a.id), label: a.name }))}
          />
          <Select
            label="Status"
            placeholder="Any"
            clearable
            w={160}
            value={filters.status || null}
            onChange={(v) => setFilter('status', v)}
            data={[
              { value: 'needs_review', label: 'Needs review (any)' },
              { value: 'unreviewed', label: 'Unreviewed' },
              { value: 'suggested', label: 'Suggested' },
              { value: 'reviewed', label: 'Reviewed' },
            ]}
          />
          <Select
            label="Type"
            placeholder="Any"
            clearable
            w={140}
            value={filters.classification || null}
            onChange={(v) => setFilter('classification', v)}
            data={[
              { value: 'business', label: 'Business' },
              { value: 'personal', label: 'Personal' },
              { value: 'transfer', label: 'Transfer' },
              { value: 'none', label: 'Not decided' },
            ]}
          />
          <CategorySelect label="Category" w={220} value={filters.categoryId ? Number(filters.categoryId) : null} onChange={(id) => setFilter('categoryId', id ? String(id) : null)} />
          <SegmentedControl
            size="sm"
            value={filters.direction}
            onChange={(v) => setFilter('direction', v)}
            data={[
              { value: '', label: 'All' },
              { value: 'out', label: 'Money out' },
              { value: 'in', label: 'Money in' },
            ]}
          />
          <TextInput
            label="Search"
            placeholder="Merchant, city, amount, note"
            leftSection={<IconSearch size={16} />}
            value={search}
            onChange={(e) => {
              setSearch(e.currentTarget.value);
              setFilter('q', e.currentTarget.value);
            }}
            w={220}
          />
          {[...params.keys()].length > 0 && (
            <Button variant="subtle" color="gray" leftSection={<IconX size={14} />} onClick={() => { setSearch(''); setParams(new URLSearchParams(), { replace: true }); }}>
              Clear
            </Button>
          )}
        </Group>
      </Paper>

      <Paper withBorder p="xs" mb="xs" className="bulk-bar" bg={selCount ? 'var(--mantine-color-cyan-light)' : undefined}>
        <Group justify="space-between" wrap="wrap" gap="xs">
          <Group gap="xs">
            {selCount ? (
              <>
                <Text fw={600} size="sm">
                  {selCount} selected
                </Text>
                {allOnPage && !allMatching && (data?.total ?? 0) > selected.size && (
                  <Button size="compact-sm" variant="subtle" onClick={() => setAllMatching(true)}>
                    Select all {data?.total} matching
                  </Button>
                )}
              </>
            ) : (
              <Text size="sm" c="dimmed">
                {data ? `${data.total} transactions · out ${money(data.totals.outCents)} · in ${money(data.totals.inCents)}` : 'Loading…'}
                {isFetching ? ' …' : ''}
              </Text>
            )}
          </Group>
          {selCount > 0 && (
            <Group gap={6}>
              <Button size="compact-sm" onClick={() => act({ classification: 'business' })}>
                Business
              </Button>
              <Button size="compact-sm" variant="default" onClick={() => act({ classification: 'personal' })}>
                Personal
              </Button>
              <Button size="compact-sm" variant="default" onClick={() => act({ classification: 'transfer' })}>
                Transfer
              </Button>
              <CategorySelect size="xs" w={210} placeholder="Set category…" value={null} onChange={(id) => id && act({ categoryId: id })} />
              <Menu position="bottom-end">
                <Menu.Target>
                  <Button size="compact-sm" variant="default" rightSection={<IconChevronDown size={14} />}>
                    More
                  </Button>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item onClick={() => act({ approve: true })}>Approve suggestions</Menu.Item>
                  <Menu.Item onClick={() => act({ reset: true })}>Move back to Needs Review</Menu.Item>
                </Menu.Dropdown>
              </Menu>
              <Button size="compact-sm" variant="subtle" color="gray" onClick={() => { setSelected(new Set()); setAllMatching(false); }}>
                Clear
              </Button>
            </Group>
          )}
        </Group>
      </Paper>

      <Paper withBorder>
        <Table.ScrollContainer minWidth={900}>
          <Table className="tx-table" highlightOnHover verticalSpacing={6} fz="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36}>
                  <Checkbox
                    aria-label="Select page"
                    checked={allOnPage || allMatching}
                    indeterminate={!allOnPage && selected.size > 0}
                    onChange={() => {
                      setAllMatching(false);
                      setSelected(allOnPage ? new Set() : new Set(pageIds));
                    }}
                  />
                </Table.Th>
                <Table.Th w={110}>Date</Table.Th>
                <Table.Th>Merchant</Table.Th>
                <Table.Th w={140}>Account</Table.Th>
                <Table.Th w={110} ta="right">
                  Amount
                </Table.Th>
                <Table.Th w={120}>Type</Table.Th>
                <Table.Th w={240}>Category</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((t) => (
                <Row
                  key={t.id}
                  t={t}
                  selected={allMatching || selected.has(t.id)}
                  onToggle={() => toggle(t.id)}
                  onOpen={() => setOpenId(t.id)}
                  accountName={accountMap.get(t.accountId)?.name ?? ''}
                  categoryName={t.categoryId ? categories.get(t.categoryId)?.name ?? '' : ''}
                  onCategory={(id) => bulk.mutate({ ids: [t.id], categoryId: id, quiet: true })}
                />
              ))}
              {rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="xl">
                      No transactions match. Import a bank file or clear the filters.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {(data?.total ?? 0) > PAGE && (
        <Group justify="center" mt="md">
          <Pagination value={page} onChange={setPage} total={Math.ceil((data?.total ?? 0) / PAGE)} />
        </Group>
      )}

      <TransactionDrawer id={openId} onClose={() => setOpenId(null)} />
      <ManualEntryModal opened={manualOpen} onClose={manual.close} />
    </>
  );
}

function Row({
  t,
  selected,
  onToggle,
  onOpen,
  accountName,
  categoryName,
  onCategory,
}: {
  t: Transaction;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  accountName: string;
  categoryName: string;
  onCategory: (id: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <Table.Tr data-selected={selected} onClick={onOpen}>
      <Table.Td onClick={(e) => e.stopPropagation()}>
        <Checkbox aria-label={`Select ${t.merchant}`} checked={selected} onChange={onToggle} />
      </Table.Td>
      <Table.Td className="nowrap">{shortDate(t.date)}</Table.Td>
      <Table.Td>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={500} lineClamp={1}>
            {t.merchant}
          </Text>
          <SourceIcon source={t.source} confidence={t.confidence} />
        </Group>
        <Group gap={6}>
          <Location t={t} />
          {t.notes && (
            <Text size="xs" c="dimmed" lineClamp={1}>
              📝 {t.notes}
            </Text>
          )}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed" lineClamp={1}>
          {accountName}
        </Text>
      </Table.Td>
      <Table.Td ta="right">
        <Money cents={t.amountCents} size="sm" />
      </Table.Td>
      <Table.Td>
        <ClassBadge t={t} />
      </Table.Td>
      <Table.Td onClick={(e) => e.stopPropagation()}>
        {t.isSplit ? (
          <Text size="xs" c="dimmed">
            {t.splits.length} lines
          </Text>
        ) : t.classification === 'personal' || t.classification === 'transfer' ? (
          <Text size="xs" c="dimmed">
            —
          </Text>
        ) : editing ? (
          <CategorySelect
            size="xs"
            autoFocus
            defaultDropdownOpened
            value={t.categoryId}
            incomeFirst={t.amountCents > 0}
            onChange={(id) => {
              onCategory(id);
              setEditing(false);
            }}
            onDropdownClose={() => setEditing(false)}
          />
        ) : (
          <Text
            size="sm"
            c={categoryName ? (t.status === 'reviewed' ? undefined : 'dimmed') : 'dimmed'}
            fs={t.status === 'reviewed' ? undefined : 'italic'}
            style={{ cursor: 'pointer' }}
            onClick={() => setEditing(true)}
            lineClamp={1}
          >
            {categoryName || 'Choose…'}
          </Text>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function ManualEntryModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const accounts = useAccounts();
  const refresh = useRefreshAll();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [date, setDate] = useState<string | null>(toIso(new Date()) ?? null);
  const [amount, setAmount] = useState<number | string>('');
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [description, setDescription] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const cashAccounts = useMemo(() => accounts.data ?? [], [accounts.data]);
  const create = useMutation({
    mutationFn: () =>
      api.post('/api/transactions', {
        accountId: Number(accountId),
        date,
        amountCents: Math.round(Number(amount) * 100) * (direction === 'out' ? -1 : 1),
        description,
        categoryId,
        notes,
      }),
    onSuccess: () => {
      refresh();
      setAmount('');
      setDescription('');
      setNotes('');
      setCategoryId(null);
      onClose();
    },
    onError: notifyError,
  });
  const ensureCash = useMutation({
    mutationFn: () => api.post<{ id: number }>('/api/accounts', { name: 'Cash', type: 'cash' }),
    onSuccess: (a) => {
      refresh();
      setAccountId(String(a.id));
    },
    onError: notifyError,
  });

  return (
    <Modal opened={opened} onClose={onClose} title="Add a cash or manual transaction">
      <Stack>
        <Group align="flex-end" gap="xs">
          <Select
            label="Paid from"
            style={{ flex: 1 }}
            value={accountId}
            onChange={setAccountId}
            data={cashAccounts.map((a) => ({ value: String(a.id), label: a.name }))}
            placeholder="Choose account"
          />
          {!cashAccounts.some((a) => a.type === 'cash') && (
            <Button variant="default" onClick={() => ensureCash.mutate()}>
              + Cash account
            </Button>
          )}
        </Group>
        <DateInput label="Date" value={date} onChange={(v) => setDate(v ? toIso(v) ?? null : null)} valueFormat="MMM D, YYYY" />
        <SegmentedControl
          value={direction}
          onChange={(v) => setDirection(v as 'out' | 'in')}
          data={[
            { value: 'out', label: 'Expense (money out)' },
            { value: 'in', label: 'Income (money in)' },
          ]}
        />
        <NumberInput label="Amount" prefix="$" decimalScale={2} min={0} value={amount} onChange={setAmount} />
        <TextInput label="Description" placeholder="e.g. Parking meter, Detroit" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
        <CategorySelect label="Category (makes it business)" value={categoryId} onChange={setCategoryId} incomeFirst={direction === 'in'} />
        <TextInput label="Note" placeholder="Business purpose" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
        <Button onClick={() => create.mutate()} loading={create.isPending} disabled={!accountId || !date || !amount || !description}>
          Add
        </Button>
      </Stack>
    </Modal>
  );
}
