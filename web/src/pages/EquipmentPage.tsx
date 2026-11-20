import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconAlertTriangle, IconBell, IconPencil, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react';
import { depreciationSchedule, assetWarnings, suggestMethod, REPLACE_AFTER_YEARS, type AssetType, type DepreciationMethod } from '@et/core';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

export const TYPE_LABEL: Record<AssetType, string> = {
  camera: 'Camera',
  lens: 'Lens',
  audio: 'Audio',
  lighting: 'Lighting',
  drone: 'Drone',
  computer: 'Computer',
  phone_tablet: 'Phone / tablet',
  software: 'Software (owned)',
  furniture: 'Furniture',
  vehicle: 'Vehicle',
  other: 'Other',
};

export const METHOD_LABEL: Record<DepreciationMethod, string> = {
  de_minimis: 'De minimis (≤ $2,500)',
  section179: 'Section 179',
  bonus: '100% bonus',
  macrs5: '5-year MACRS',
  macrs7: '7-year MACRS',
  straight_line: 'Straight-line',
};

const METHOD_HELP: Record<DepreciationMethod, string> = {
  de_minimis: 'Items $2,500 or less: write it all off this year as a normal expense. Simplest option.',
  section179: 'Write off the whole business cost this year. Can’t be more than your business income.',
  bonus: 'Write off the whole business cost this year, even if it creates a loss.',
  macrs5: 'Spread over 6 tax years (5-year property). Useful if you expect higher income later.',
  macrs7: 'Spread over 8 tax years (7-year property, e.g. furniture).',
  straight_line: 'Equal amounts each year. Required for listed property used 50% or less for business.',
};

interface Asset {
  id: number;
  name: string;
  type: AssetType;
  purchaseDate: string;
  placedInService: string;
  costCents: number;
  businessUsePct: number;
  method: DepreciationMethod;
  lifeYears: number | null;
  vendor: string | null;
  serialNumber: string | null;
  warrantyUntil: string | null;
  replaceAfterYears: number | null;
  transactionId: number | null;
  transaction: { date: string; description: string; amountCents: number } | null;
  disposedDate: string | null;
  disposedAmountCents: number | null;
  notes: string | null;
  basisCents: number;
  countsForTaxes: boolean;
  deductionThisYearCents: number;
  deductedThroughYearCents: number;
  remainingAfterYearCents: number;
  warnings: string[];
}

interface EquipmentData {
  year: number;
  assets: Asset[];
  summary: { deductionCents: number; byMethod: Record<string, number>; activeCount: number; activeCostCents: number };
  section179Warning: string | null;
  reminders: { kind: 'warranty' | 'replace'; date: string; message: string; assetId: number }[];
  unregistered: { transactionId: number; date: string; description: string; costCents: number; overDeMinimis: boolean }[];
}

type Draft = Partial<Omit<Asset, 'id'>> & { id?: number; transactionId?: number | null };

export function EquipmentPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const [params, setParams] = useSearchParams();
  const refresh = useRefreshAll();
  const { data, refetch } = useQuery({ queryKey: ['assets', year], queryFn: () => api.get<EquipmentData>(`/api/assets?year=${year}`) });
  const [editing, setEditing] = useState<Draft | null>(null);
  const del = useMutation({
    mutationFn: (id: number) => api.del(`/api/assets/${id}`),
    onSuccess: () => {
      refresh();
      void refetch();
    },
    onError: notifyError,
  });

  const startFromTransaction = async (transactionId: number) => {
    try {
      setEditing(await api.get<Draft>(`/api/assets/suggest?transactionId=${transactionId}`));
    } catch (e) {
      notifyError(e as Error);
    }
  };

  // Opened from a transaction's "Add to equipment register" button.
  const fromTx = params.get('fromTransaction');
  useEffect(() => {
    if (!fromTx) return;
    void startFromTransaction(Number(fromTx));
    setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromTx]);

  if (!data) return <Text c="dimmed">Loading…</Text>;
  const active = data.assets.filter((a) => !a.disposedDate);
  const years = Array.from({ length: 6 }, (_, i) => String(thisYear - 4 + i));

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="Equipment"
          description="Gear and other things you own for the business: what each writes off this year (Schedule C line 13 / Form 4562), warranties, and when it’s due for replacement. A planning tool — confirm write-off choices with your tax preparer."
          right={
            <Group>
              <Select w={100} data={years} value={String(year)} onChange={(v) => v && setYear(Number(v))} aria-label="Tax year" allowDeselect={false} />
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
                Print gear list
              </Button>
              <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({ type: 'other', businessUsePct: 100, replaceAfterYears: REPLACE_AFTER_YEARS.other })}>
                Add equipment
              </Button>
            </Group>
          }
        />
        <Stack>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <Kpi label={`Write-off for ${year}`} value={money(data.summary.deductionCents)} hint="Goes on Schedule C line 13" />
            <Kpi label="Gear in use" value={money(data.summary.activeCostCents)} hint={`${active.length} item${active.length === 1 ? '' : 's'} · what you paid (for insurance)`} />
            <Kpi
              label="Reminders"
              value={String(data.reminders.length)}
              hint={data.reminders[0] ? `Next: ${shortDate(data.reminders[0].date)}` : 'Warranties ending and gear due for replacement'}
            />
          </SimpleGrid>

          {data.section179Warning && (
            <Alert color="orange" icon={<IconAlertTriangle size={18} />}>
              {data.section179Warning}
            </Alert>
          )}

          {data.reminders.length > 0 && (
            <Paper withBorder p="md">
              <Title order={5} mb="xs">
                <Group gap={6}>
                  <IconBell size={18} /> Coming up
                </Group>
              </Title>
              <Stack gap={4}>
                {data.reminders.map((r, i) => (
                  <Group key={i} gap="xs" wrap="nowrap">
                    <Badge size="sm" variant="light" color={r.kind === 'warranty' ? 'blue' : 'grape'} w={90}>
                      {r.kind === 'warranty' ? 'Warranty' : 'Replace'}
                    </Badge>
                    <Text size="sm">{r.message}</Text>
                  </Group>
                ))}
              </Stack>
            </Paper>
          )}

          {data.unregistered.length > 0 && (
            <Paper withBorder p="md">
              <Title order={5}>Equipment purchases not in the register yet</Title>
              <Text size="sm" c="dimmed" mb="xs">
                Anything over $2,500 can’t just be expensed — add it so the write-off is right. Smaller items are fine as they are; adding them helps you track warranties and
                insurance.
              </Text>
              <Table fz="sm" verticalSpacing={4}>
                <Table.Tbody>
                  {data.unregistered.map((u) => (
                    <Table.Tr key={u.transactionId}>
                      <Table.Td w={120}>{shortDate(u.date)}</Table.Td>
                      <Table.Td>
                        {u.description}{' '}
                        {u.overDeMinimis && (
                          <Badge size="xs" color="orange" variant="light">
                            over $2,500
                          </Badge>
                        )}
                      </Table.Td>
                      <Table.Td ta="right" ff="monospace">
                        {money(u.costCents)}
                      </Table.Td>
                      <Table.Td w={90} ta="right">
                        <Button size="compact-xs" variant="light" onClick={() => void startFromTransaction(u.transactionId)}>
                          Add
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>
          )}

          <Paper withBorder p="md">
            <Title order={5} mb="xs">
              Register
            </Title>
            {data.assets.length === 0 ? (
              <Text size="sm" c="dimmed">
                Nothing here yet. Add gear by hand, or open a purchase in Transactions and choose “Add to equipment register”.
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={820}>
                <Table fz="sm" verticalSpacing={6} highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Item</Table.Th>
                      <Table.Th>Bought</Table.Th>
                      <Table.Th ta="right">Cost</Table.Th>
                      <Table.Th ta="right">Business</Table.Th>
                      <Table.Th>Write-off method</Table.Th>
                      <Table.Th ta="right">{year} write-off</Table.Th>
                      <Table.Th ta="right">Left to write off</Table.Th>
                      <Table.Th />
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.assets.map((a) => (
                      <Table.Tr key={a.id} c={a.disposedDate ? 'dimmed' : undefined}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {a.name}{' '}
                            {a.disposedDate && (
                              <Badge size="xs" color="gray">
                                sold {shortDate(a.disposedDate)}
                              </Badge>
                            )}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {TYPE_LABEL[a.type]}
                            {a.serialNumber ? ` · S/N ${a.serialNumber}` : ''}
                            {a.warrantyUntil ? ` · warranty to ${shortDate(a.warrantyUntil)}` : ''}
                          </Text>
                          {a.warnings.map((w) => (
                            <Text key={w} size="xs" c="orange.8">
                              {w}
                            </Text>
                          ))}
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{shortDate(a.purchaseDate)}</Text>
                          <Text size="xs" c="dimmed">
                            {a.transactionId ? (
                              <Anchor component={Link} to={`/transactions?q=${encodeURIComponent(a.transaction?.description ?? '')}`} size="xs">
                                {a.vendor ?? 'bank transaction'}
                              </Anchor>
                            ) : (
                              (a.vendor ?? 'entered by hand')
                            )}
                          </Text>
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {money(a.costCents)}
                        </Table.Td>
                        <Table.Td ta="right">{a.businessUsePct}%</Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={a.method === 'macrs5' || a.method === 'macrs7' || a.method === 'straight_line' ? 'blue' : 'teal'}>
                            {METHOD_LABEL[a.method]}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace" fw={600}>
                          {money(a.deductionThisYearCents)}
                        </Table.Td>
                        <Table.Td ta="right" ff="monospace">
                          {money(a.remainingAfterYearCents)}
                        </Table.Td>
                        <Table.Td w={70}>
                          <Group gap={2} wrap="nowrap">
                            <Tooltip label="Edit">
                              <ActionIcon variant="subtle" onClick={() => setEditing(a)} aria-label={`Edit ${a.name}`}>
                                <IconPencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <ActionIcon
                                variant="subtle"
                                color="red"
                                aria-label={`Delete ${a.name}`}
                                onClick={() => window.confirm(`Delete ${a.name} from the register?`) && del.mutate(a.id)}
                              >
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Paper>
        </Stack>
      </div>

      <GearListPrint assets={active} />
      {editing && (
        <AssetModal
          initial={editing}
          onClose={() => {
            setEditing(null);
            refresh();
            void refetch();
          }}
        />
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

/** Printable list for insurance: what you own, serial numbers, what it cost. */
function GearListPrint({ assets }: { assets: Asset[] }) {
  return (
    <div className="print-only">
      <Title order={3}>Business equipment list</Title>
      <Text size="sm" mb="sm">
        Printed {shortDate(new Date().toISOString().slice(0, 10))} · {assets.length} items · total cost {money(assets.reduce((s, a) => s + a.costCents, 0))}
      </Text>
      <Table fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Item</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th>Serial #</Table.Th>
            <Table.Th>Bought</Table.Th>
            <Table.Th>From</Table.Th>
            <Table.Th ta="right">Cost</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {assets.map((a) => (
            <Table.Tr key={a.id}>
              <Table.Td>{a.name}</Table.Td>
              <Table.Td>{TYPE_LABEL[a.type]}</Table.Td>
              <Table.Td>{a.serialNumber ?? ''}</Table.Td>
              <Table.Td>{shortDate(a.purchaseDate)}</Table.Td>
              <Table.Td>{a.vendor ?? ''}</Table.Td>
              <Table.Td ta="right">{money(a.costCents)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </div>
  );
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function AssetModal({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const [d, setD] = useState<Draft>({ ...initial });
  const [methodTouched, setMethodTouched] = useState(!!initial.id || !!initial.method);
  const set = (patch: Draft) => setD((x) => ({ ...x, ...patch }));
  const cost = d.costCents ?? 0;

  // Until you pick a method yourself, follow the cost: ≤ $2,500 → de minimis, otherwise Section 179.
  useEffect(() => {
    if (!methodTouched && cost > 0) set({ method: suggestMethod(cost) });
  }, [cost, methodTouched]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: d.name,
        type: d.type,
        purchaseDate: d.purchaseDate,
        placedInService: d.placedInService || d.purchaseDate,
        costCents: d.costCents,
        businessUsePct: d.businessUsePct ?? 100,
        method: d.method,
        lifeYears: d.method === 'straight_line' ? (d.lifeYears ?? 5) : null,
        vendor: d.vendor ?? null,
        serialNumber: d.serialNumber ?? null,
        warrantyUntil: d.warrantyUntil || null,
        replaceAfterYears: d.replaceAfterYears ?? null,
        disposedDate: d.disposedDate || null,
        disposedAmountCents: d.disposedDate ? (d.disposedAmountCents ?? null) : null,
        notes: d.notes ?? null,
        transactionId: d.transactionId ?? null,
      };
      return d.id ? api.patch(`/api/assets/${d.id}`, body) : api.post('/api/assets', body);
    },
    onSuccess: onClose,
    onError: notifyError,
  });

  const placed = d.placedInService || d.purchaseDate || '';
  const preview = useMemo(() => {
    if (!cost || !d.method || !ISO.test(placed)) return null;
    return depreciationSchedule({
      costCents: cost,
      businessUsePct: d.businessUsePct ?? 100,
      placedInService: placed,
      method: d.method,
      lifeYears: d.lifeYears ?? 5,
      disposedDate: d.disposedDate && ISO.test(d.disposedDate) ? d.disposedDate : null,
    });
  }, [cost, d.method, d.businessUsePct, placed, d.lifeYears, d.disposedDate]);
  const warnings =
    cost && d.method && d.type
      ? assetWarnings({ costCents: cost, businessUsePct: d.businessUsePct ?? 100, placedInService: placed, method: d.method, type: d.type, disposedDate: d.disposedDate })
      : [];

  return (
    <Modal opened onClose={onClose} size="lg" title={d.id ? `Edit ${initial.name}` : 'Add equipment'}>
      <Stack gap="sm">
        {d.transactionId && !d.id && (
          <Text size="sm" c="dimmed">
            From your purchase on {d.purchaseDate ? shortDate(d.purchaseDate) : '—'}. If the order had several items, add each one with its own price — anything left
            over stays a normal expense.
          </Text>
        )}
        <Group grow align="flex-start">
          <TextInput label="What is it?" placeholder="e.g. Sony A7 IV body" required value={d.name ?? ''} onChange={(e) => set({ name: e.currentTarget.value })} />
          <Select
            label="Type"
            allowDeselect={false}
            data={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
            value={d.type ?? 'other'}
            onChange={(v) => {
              const type = (v ?? 'other') as AssetType;
              set({ type, replaceAfterYears: d.id ? d.replaceAfterYears : REPLACE_AFTER_YEARS[type] });
            }}
          />
        </Group>
        <Group grow align="flex-start">
          <NumberInput
            label="Cost"
            prefix="$"
            thousandSeparator
            decimalScale={2}
            min={0}
            required
            value={d.costCents !== undefined ? d.costCents / 100 : ''}
            onChange={(v) => set({ costCents: v === '' ? undefined : Math.round(Number(v) * 100) })}
          />
          <NumberInput
            label="Business use %"
            description="Share of the time it’s used for work"
            min={0}
            max={100}
            suffix="%"
            value={d.businessUsePct ?? 100}
            onChange={(v) => set({ businessUsePct: v === '' ? 100 : Number(v) })}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput label="Bought on" type="date" required value={d.purchaseDate ?? ''} onChange={(e) => set({ purchaseDate: e.currentTarget.value })} />
          <TextInput
            label="First used for work"
            description="If later than the purchase"
            type="date"
            value={d.placedInService ?? ''}
            onChange={(e) => set({ placedInService: e.currentTarget.value })}
          />
        </Group>
        <Select
          label="How to write it off"
          allowDeselect={false}
          data={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))}
          value={d.method ?? null}
          onChange={(v) => {
            setMethodTouched(true);
            set({ method: (v ?? undefined) as DepreciationMethod });
          }}
          description={d.method ? METHOD_HELP[d.method] : 'Fill in the cost and we’ll suggest one'}
        />
        {d.method === 'straight_line' && (
          <NumberInput label="Useful life (years)" min={1} max={40} w={200} value={d.lifeYears ?? 5} onChange={(v) => set({ lifeYears: Number(v) || 5 })} />
        )}
        {preview && preview.length > 0 && (
          <Paper withBorder p="xs" bg="var(--mantine-color-gray-0)">
            <Text size="xs" fw={600} mb={4}>
              Write-off by year
            </Text>
            <Group gap="md">
              {preview.map((p) => (
                <Text key={p.year} size="xs" ff="monospace">
                  {p.year}: {money(p.deductionCents)}
                </Text>
              ))}
            </Group>
          </Paper>
        )}
        {warnings.map((w) => (
          <Alert key={w} color="orange" p="xs" icon={<IconAlertTriangle size={16} />}>
            <Text size="xs">{w}</Text>
          </Alert>
        ))}
        <Group grow align="flex-start">
          <TextInput label="Bought from" value={d.vendor ?? ''} onChange={(e) => set({ vendor: e.currentTarget.value })} />
          <TextInput label="Serial number" value={d.serialNumber ?? ''} onChange={(e) => set({ serialNumber: e.currentTarget.value })} />
        </Group>
        <Group grow align="flex-start">
          <TextInput label="Warranty ends" type="date" value={d.warrantyUntil ?? ''} onChange={(e) => set({ warrantyUntil: e.currentTarget.value })} />
          <NumberInput
            label="Plan to replace after (years)"
            min={1}
            max={50}
            value={d.replaceAfterYears ?? ''}
            onChange={(v) => set({ replaceAfterYears: v === '' ? null : Number(v) })}
          />
        </Group>
        <Group grow align="flex-start">
          <TextInput label="Sold / retired on" description="Leave empty while you still use it" type="date" value={d.disposedDate ?? ''} onChange={(e) => set({ disposedDate: e.currentTarget.value })} />
          <NumberInput
            label="Sold for"
            prefix="$"
            thousandSeparator
            decimalScale={2}
            min={0}
            disabled={!d.disposedDate}
            value={d.disposedAmountCents != null ? d.disposedAmountCents / 100 : ''}
            onChange={(v) => set({ disposedAmountCents: v === '' ? null : Math.round(Number(v) * 100) })}
          />
        </Group>
        <Textarea label="Notes" autosize minRows={1} value={d.notes ?? ''} onChange={(e) => set({ notes: e.currentTarget.value })} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!d.name || !cost || !d.purchaseDate}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
