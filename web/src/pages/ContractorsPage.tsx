import {
  Alert,
  Anchor,
  Badge,
  Button,
  Checkbox,
  Drawer,
  Group,
  List,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconDownload, IconPlus } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { api, type Contractor, type Contractor1099Summary, type EntityType, type Transaction } from '../api';
import { Money, PageHeader } from '../components/bits';
import { useContractors } from '../components/PartySelects';
import { money, shortDate } from '../format';
import { notifyError, useBulkUpdate, useRefreshAll } from '../hooks';

const ENTITY_LABEL: Record<EntityType, string> = {
  individual: 'Individual',
  sole_prop: 'Sole proprietor',
  llc: 'LLC (single-member or partnership)',
  partnership: 'Partnership',
  s_corp: 'S corporation',
  c_corp: 'C corporation',
  other: 'Other',
};

function StatusBadge({ s }: { s: Contractor1099Summary }) {
  if (s.needs1099) return <Badge color="red" variant="light">1099-NEC needed</Badge>;
  if (s.exemptCorporation) return <Badge color="gray" variant="light">Corporation — usually exempt</Badge>;
  if (s.approaching) return <Badge color="orange" variant="light">Approaching threshold</Badge>;
  return <Badge color="gray" variant="outline">Under threshold</Badge>;
}

interface NecReport {
  year: number;
  thresholdCents: number;
  deadline: string;
  needCount: number;
}

export function ContractorsPage() {
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data } = useContractors(year);
  const report = useQuery({ queryKey: ['reports', '1099-nec', year], queryFn: () => api.get<NecReport>(`/api/reports/1099-nec?year=${year}`) });
  const [openId, setOpenId] = useState<number | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const rows = (data ?? []).filter((c) => showArchived || !c.archived);

  return (
    <>
      <PageHeader
        title="Contractors & 1099s"
        description="People and companies you pay for work. Tag their payments (category “Contract labor”, contractor = who) and the app tracks when you'll owe them a 1099-NEC."
        right={
          <Group>
            <Select w={100} value={String(year)} onChange={(v) => v && setYear(Number(v))} data={Array.from({ length: 5 }, (_, i) => String(thisYear - i))} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setOpenId('new')}>
              New contractor
            </Button>
          </Group>
        }
      />

      {report.data && (
        <Alert color={report.data.needCount ? 'red' : 'gray'} variant="light" mb="md" title={`${year}: ${report.data.needCount} contractor${report.data.needCount === 1 ? '' : 's'} need a 1099-NEC`}>
          <Text size="sm">
            Threshold for {year}: <b>{money(report.data.thresholdCents)}</b> paid directly (check, bank transfer/ACH, Zelle, cash). It was $600 for
            payments through 2025 and is $2,000 from 2026. Card and PayPal/Venmo-for-business/Stripe payments don't count — the processor
            reports those. Send the form to the contractor and file it with the IRS by <b>{shortDate(report.data.deadline)}</b>.
          </Text>
          <Group mt="xs" gap="xs">
            <Button size="xs" variant="default" component="a" href={`/api/reports/1099-nec.csv?year=${year}`} leftSection={<IconDownload size={14} />}>
              Download 1099 list (CSV)
            </Button>
            <Text size="xs" c="dimmed">
              File free with the IRS IRIS portal, or any 1099 e-file service. The CSV has the Box 1 amounts.
            </Text>
          </Group>
        </Alert>
      )}

      <Paper withBorder>
        <Table.ScrollContainer minWidth={850}>
          <Table highlightOnHover fz="sm" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Contractor</Table.Th>
                <Table.Th>W-9</Table.Th>
                <Table.Th ta="right">Paid directly</Table.Th>
                <Table.Th ta="right">Card / processor</Table.Th>
                <Table.Th>{year} status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => (
                <Table.Tr key={c.id} style={{ cursor: 'pointer', opacity: c.archived ? 0.5 : 1 }} onClick={() => setOpenId(c.id)}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{c.name}</Text>
                    <Text size="xs" c="dimmed">{[c.businessName, ENTITY_LABEL[c.entityType]].filter(Boolean).join(' · ')}</Text>
                    {c.summary?.warnings.map((w) => (
                      <Text key={w} size="xs" c="orange.8">{w}</Text>
                    ))}
                  </Table.Td>
                  <Table.Td>{c.w9Received ? <Badge color="teal" variant="light">on file</Badge> : <Badge color="gray" variant="outline">missing</Badge>}</Table.Td>
                  <Table.Td ta="right" ff="monospace">{money(c.summary?.directCents ?? 0)}</Table.Td>
                  <Table.Td ta="right" ff="monospace" c="dimmed">{money(c.summary?.processorCents ?? 0)}</Table.Td>
                  <Table.Td>{c.summary && <StatusBadge s={c.summary} />}</Table.Td>
                </Table.Tr>
              ))}
              {rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="lg" size="sm">
                      No contractors yet. Add one here or type a name in the Contractor box on a payment.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>

      <Paper withBorder p="md" mt="md">
        <Title order={5} mb="xs">Hiring someone? Checklist</Title>
        <List size="sm" spacing={4}>
          <List.Item>
            Before the first payment, get a signed{' '}
            <Anchor href="https://www.irs.gov/forms-pubs/about-form-w-9" target="_blank" rel="noreferrer">
              Form W-9
            </Anchor>{' '}
            (name, address, SSN/EIN, business type). Keep the paper/PDF yourself — this app only stores the last 4 digits.
          </List.Item>
          <List.Item>Paying by credit card or PayPal goods &amp; services means no 1099-NEC from you (the processor reports it).</List.Item>
          <List.Item>Tag each payment with the contractor so the totals here stay right.</List.Item>
          <List.Item>Workers you control like employees (set hours, your tools, ongoing) may need to be employees, not contractors — check with a tax pro.</List.Item>
        </List>
      </Paper>

      {openId !== null && <ContractorDrawer id={openId} year={year} onClose={() => setOpenId(null)} />}
    </>
  );
}

interface ContractorDetail {
  contractor: Contractor;
  summary: Contractor1099Summary;
  payments: (Transaction & { method: 'direct' | 'card_or_processor'; methodInferred: boolean })[];
}

function ContractorDrawer({ id, year, onClose }: { id: number | 'new'; year: number; onClose: () => void }) {
  const refresh = useRefreshAll();
  const bulk = useBulkUpdate();
  const { data } = useQuery({
    queryKey: ['contractors', 'one', id, year],
    queryFn: () => api.get<ContractorDetail>(`/api/contractors/${id}?year=${year}`),
    enabled: id !== 'new',
  });
  const [f, setF] = useState<Partial<Contractor>>({ entityType: 'individual', w9Received: false });
  useEffect(() => {
    if (data) setF(data.contractor);
  }, [data]);
  const set = (k: keyof Contractor) => (e: { currentTarget: { value: string } }) => setF({ ...f, [k]: e.currentTarget.value });
  const save = useMutation({
    mutationFn: () => (id === 'new' ? api.post('/api/contractors', f) : api.patch(`/api/contractors/${id}`, f)),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });

  return (
    <Drawer opened onClose={onClose} position="right" size="lg" title={<Text fw={700}>{id === 'new' ? 'New contractor' : f.name}</Text>}>
      <Stack>
        {data && (
          <Paper withBorder p="sm">
            <Group justify="space-between">
              <Text size="sm">{year}: paid directly <b>{money(data.summary.directCents)}</b> · card/processor {money(data.summary.processorCents)}</Text>
              <StatusBadge s={data.summary} />
            </Group>
          </Paper>
        )}
        <TextInput label="Name (as on their W-9)" value={f.name ?? ''} onChange={set('name')} data-autofocus />
        <TextInput label="Business name (if any)" value={f.businessName ?? ''} onChange={set('businessName')} />
        <Select
          label="Business type (box 3 of their W-9)"
          value={f.entityType}
          onChange={(v) => v && setF({ ...f, entityType: v as EntityType })}
          data={Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }))}
        />
        <TextInput label="Email" value={f.email ?? ''} onChange={set('email')} />
        <Textarea label="Mailing address" autosize minRows={2} value={f.address ?? ''} onChange={set('address')} />
        <TextInput
          label="SSN / EIN — last 4 digits only"
          description="Only the last 4 digits are saved. Keep the full number on the W-9 itself."
          maxLength={11}
          value={f.tinLast4 ?? ''}
          onChange={set('tinLast4')}
        />
        <Group>
          <Switch label="W-9 received" checked={!!f.w9Received} onChange={(e) => setF({ ...f, w9Received: e.currentTarget.checked })} />
          <TextInput type="date" size="xs" value={f.w9Date ?? ''} onChange={set('w9Date')} disabled={!f.w9Received} />
        </Group>
        <Textarea label="Notes" autosize minRows={2} value={f.notes ?? ''} onChange={set('notes')} />
        {id !== 'new' && <Checkbox label="Archived" checked={!!f.archived} onChange={(e) => setF({ ...f, archived: e.currentTarget.checked })} />}
        <Button onClick={() => save.mutate()} disabled={!f.name?.trim()} loading={save.isPending}>
          Save
        </Button>

        {data && (
          <>
            <Title order={5} mt="md">Payments</Title>
            <Text size="xs" c="dimmed">
              “Direct” counts toward the 1099-NEC. If a PayPal/Venmo payment was “friends &amp; family” (no 1099-K), switch it to direct.
            </Text>
            <Table fz="sm" verticalSpacing={4}>
              <Table.Tbody>
                {data.payments.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td w={100}>{shortDate(p.date)}</Table.Td>
                    <Table.Td>
                      <Text size="xs" lineClamp={1}>{p.description}</Text>
                    </Table.Td>
                    <Table.Td ta="right"><Money cents={p.amountCents} size="sm" /></Table.Td>
                    <Table.Td w={190}>
                      <SegmentedControl
                        size="xs"
                        value={p.method}
                        onChange={(v) => bulk.mutate({ ids: [p.id], paymentMethod: v as 'direct', quiet: true })}
                        data={[
                          { value: 'direct', label: 'Direct' },
                          { value: 'card_or_processor', label: 'Card/processor' },
                        ]}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
                {data.payments.length === 0 && (
                  <Table.Tr>
                    <Table.Td>
                      <Text size="sm" c="dimmed">No payments tagged yet.</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </>
        )}
      </Stack>
    </Drawer>
  );
}
