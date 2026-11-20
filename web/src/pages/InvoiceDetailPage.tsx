import { ActionIcon, Alert, Badge, Button, Divider, Group, NumberInput, Paper, Select, SimpleGrid, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconArrowLeft, IconPlus, IconPrinter, IconTrash } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Invoice, type InvoiceLineApi, type TripListItem } from '../api';
import { ClientSelect, ProjectSelect } from '../components/PartySelects';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';
import { INVOICE_STATE_COLOR, useLinkPayment } from './InvoicesPage';

function today() {
  return new Date().toISOString().slice(0, 10);
}

export function InvoiceDetailPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const isNew = params.id === 'new';
  const id = isNew ? null : Number(params.id);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const link = useLinkPayment();
  const { data } = useQuery({ queryKey: ['invoices', 'one', id], queryFn: () => api.get<Invoice>(`/api/invoices/${id}`), enabled: !isNew });
  const trips = useQuery({ queryKey: ['trips'], queryFn: () => api.get<TripListItem[]>('/api/trips') });

  const [clientId, setClientId] = useState<number | null>(search.get('clientId') ? Number(search.get('clientId')) : null);
  const [projectId, setProjectId] = useState<number | null>(null);
  const [tripId, setTripId] = useState<number | null>(search.get('tripId') ? Number(search.get('tripId')) : null);
  const [number, setNumber] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState('');
  const [status, setStatus] = useState<Invoice['status']>('sent');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<InvoiceLineApi[]>([{ description: '', quantity: 1, unitCents: 0 }]);
  const [payAmount, setPayAmount] = useState<number | string>('');
  const [payDate, setPayDate] = useState(today());

  useEffect(() => {
    if (!data) return;
    setClientId(data.clientId);
    setProjectId(data.projectId);
    setTripId(data.tripId);
    setNumber(data.number ?? '');
    setIssueDate(data.issueDate);
    setDueDate(data.dueDate ?? '');
    setStatus(data.status);
    setNotes(data.notes ?? '');
    setLines(data.lines.length ? data.lines : [{ description: '', quantity: 1, unitCents: 0 }]);
  }, [data]);

  const total = lines.reduce((s, l) => s + Math.round((l.quantity || 0) * (l.unitCents || 0)), 0);
  const body = () => ({ clientId, projectId, tripId, number: number || undefined, issueDate, dueDate: dueDate || undefined, status, notes, lines });
  const save = useMutation({
    mutationFn: () => (isNew ? api.post<Invoice>('/api/invoices', body()) : api.patch<Invoice>(`/api/invoices/${id}`, body())),
    onSuccess: (inv) => {
      refresh();
      if (isNew) navigate(`/invoices/${inv.id}`, { replace: true });
    },
    onError: notifyError,
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/invoices/${id}`),
    onSuccess: () => {
      refresh();
      navigate('/invoices');
    },
    onError: notifyError,
  });
  const addPayment = useMutation({
    mutationFn: () => api.post(`/api/invoices/${id}/payments`, { amountCents: Math.round(Number(payAmount) * 100), date: payDate }),
    onSuccess: () => {
      setPayAmount('');
      refresh();
    },
    onError: notifyError,
  });
  const removePayment = useMutation({ mutationFn: (pid: number) => api.del(`/api/invoice-payments/${pid}`), onSuccess: refresh, onError: notifyError });

  const setLine = (i: number, patch: Partial<InvoiceLineApi>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <>
      <div className="no-print">
        <Group justify="space-between" mb="md">
          <Button component={Link} to="/invoices" variant="subtle" leftSection={<IconArrowLeft size={16} />} px={0}>
            All invoices
          </Button>
          <Group gap="xs">
            {!isNew && (
              <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
                Print / save as PDF
              </Button>
            )}
            {!isNew && (
              <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => window.confirm('Delete this invoice?') && del.mutate()}>
                Delete
              </Button>
            )}
          </Group>
        </Group>

        <Paper withBorder p="lg" mb="md">
          <Group justify="space-between" mb="md">
            <Title order={3}>{isNew ? 'New invoice' : `Invoice ${data?.number ?? ''}`}</Title>
            {data && <Badge color={INVOICE_STATE_COLOR[data.state]} size="lg" variant="light">{data.state}</Badge>}
          </Group>
          <SimpleGrid cols={{ base: 1, sm: 3 }}>
            <ClientSelect label="Client" value={clientId} onChange={setClientId} />
            <ProjectSelect label="Project (optional)" clientId={clientId} value={projectId} onChange={setProjectId} />
            <Select
              label="Business trip (optional)"
              clearable
              value={tripId ? String(tripId) : null}
              onChange={(v) => setTripId(v ? Number(v) : null)}
              data={(trips.data ?? []).map((t) => ({ value: String(t.id), label: t.name }))}
            />
            <TextInput label="Invoice number" placeholder="Automatic" value={number} onChange={(e) => setNumber(e.currentTarget.value)} />
            <TextInput type="date" label="Issue date" value={issueDate} onChange={(e) => setIssueDate(e.currentTarget.value)} />
            <TextInput type="date" label="Due date" placeholder="30 days" value={dueDate} onChange={(e) => setDueDate(e.currentTarget.value)} />
          </SimpleGrid>

          <Table mt="md" fz="sm" verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Description</Table.Th>
                <Table.Th w={100}>Qty / hours</Table.Th>
                <Table.Th w={140}>Rate</Table.Th>
                <Table.Th w={120} ta="right">Amount</Table.Th>
                <Table.Th w={40} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {lines.map((l, i) => (
                <Table.Tr key={i}>
                  <Table.Td>
                    <TextInput size="xs" placeholder="e.g. Event coverage — half day" value={l.description} onChange={(e) => setLine(i, { description: e.currentTarget.value })} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" min={0} decimalScale={2} value={l.quantity} onChange={(v) => setLine(i, { quantity: Number(v) || 0 })} />
                  </Table.Td>
                  <Table.Td>
                    <NumberInput size="xs" prefix="$" min={0} decimalScale={2} thousandSeparator value={l.unitCents / 100} onChange={(v) => setLine(i, { unitCents: Math.round(Number(v) * 100) || 0 })} />
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">{money(Math.round(l.quantity * l.unitCents))}</Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="gray" disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group justify="space-between" mt="xs">
            <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setLines((ls) => [...ls, { description: '', quantity: 1, unitCents: 0 }])}>
              Add line
            </Button>
            <Text fw={700} ff="monospace">Total {money(total)}</Text>
          </Group>
          <Textarea mt="md" label="Notes on the invoice" autosize minRows={2} value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          <Group justify="space-between" mt="md">
            <Select
              w={220}
              label="Status"
              value={status}
              onChange={(v) => v && setStatus(v as Invoice['status'])}
              data={[
                { value: 'draft', label: 'Draft (not sent yet)' },
                { value: 'sent', label: 'Sent' },
                { value: 'void', label: 'Void / cancelled' },
              ]}
            />
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!clientId || total <= 0}>
              {isNew ? 'Create invoice' : 'Save changes'}
            </Button>
          </Group>
        </Paper>

        {data && (
          <Paper withBorder p="lg" mb="md">
            <Title order={4} mb="xs">Payments</Title>
            {data.candidates.map((c) => (
              <Alert key={c.id} color="teal" variant="light" mb="xs">
                <Group justify="space-between">
                  <Text size="sm">
                    Deposit of {money(c.amountCents)} on {shortDate(c.date)} matches the balance — {c.description}
                  </Text>
                  <Button size="xs" onClick={() => link.mutate({ invoiceId: data.id, transactionId: c.id })}>
                    Mark paid with this deposit
                  </Button>
                </Group>
              </Alert>
            ))}
            <Table fz="sm">
              <Table.Tbody>
                {data.payments.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>{shortDate(p.date)}</Table.Td>
                    <Table.Td>{p.transactionId ? 'Linked bank deposit' : 'Recorded by hand'}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(p.amountCents)}</Table.Td>
                    <Table.Td w={40}>
                      <ActionIcon variant="subtle" color="gray" onClick={() => removePayment.mutate(p.id)} aria-label="Remove payment">
                        <IconTrash size={14} />
                      </ActionIcon>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
            <Text size="sm" mt="xs">
              Paid {money(data.paidCents)} of {money(data.totalCents)} · <b>{money(data.balanceCents)} still owed</b>
            </Text>
            {data.balanceCents > 0 && (
              <Group gap="xs" mt="sm" align="flex-end">
                <NumberInput size="xs" label="Record a payment" prefix="$" decimalScale={2} value={payAmount} onChange={setPayAmount} w={140} />
                <TextInput size="xs" type="date" label="Date" value={payDate} onChange={(e) => setPayDate(e.currentTarget.value)} />
                <Button size="xs" variant="default" disabled={!payAmount} onClick={() => addPayment.mutate()}>
                  Add payment
                </Button>
              </Group>
            )}
          </Paper>
        )}
      </div>

      {data && <PrintableInvoice inv={data} />}
    </>
  );
}

function PrintableInvoice({ inv }: { inv: Invoice }) {
  const b = inv.business;
  return (
    <div className="print-only">
      <Group justify="space-between" align="flex-start">
        <div>
          <Text fw={700} fz={22}>{b?.name || 'Your business name (set it in Settings)'}</Text>
          <Text size="sm" style={{ whiteSpace: 'pre-line' }}>{b?.address}</Text>
          <Text size="sm">{[b?.email, b?.phone].filter(Boolean).join(' · ')}</Text>
        </div>
        <div style={{ textAlign: 'right' }}>
          <Text fw={700} fz={28}>INVOICE</Text>
          <Text size="sm">No. {inv.number}</Text>
          <Text size="sm">Issued {shortDate(inv.issueDate)}</Text>
          {inv.dueDate && <Text size="sm">Due {shortDate(inv.dueDate)}</Text>}
        </div>
      </Group>
      <Divider my="md" />
      <Text size="sm" fw={600}>Bill to</Text>
      <Text size="sm">{inv.client?.name}</Text>
      <Text size="sm" style={{ whiteSpace: 'pre-line' }}>{inv.client?.address}</Text>
      <Text size="sm">{inv.client?.email}</Text>
      <Table mt="lg" fz="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Description</Table.Th>
            <Table.Th ta="right">Qty</Table.Th>
            <Table.Th ta="right">Rate</Table.Th>
            <Table.Th ta="right">Amount</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {inv.lines.map((l, i) => (
            <Table.Tr key={i}>
              <Table.Td>{l.description}</Table.Td>
              <Table.Td ta="right">{l.quantity}</Table.Td>
              <Table.Td ta="right">{money(l.unitCents)}</Table.Td>
              <Table.Td ta="right">{money(Math.round(l.quantity * l.unitCents))}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Stack gap={2} align="flex-end" mt="md">
        <Text size="sm">Total {money(inv.totalCents)}</Text>
        {inv.paidCents > 0 && <Text size="sm">Paid {money(inv.paidCents)}</Text>}
        <Text fw={700} fz="lg">Amount due {money(inv.balanceCents)}</Text>
      </Stack>
      {inv.notes && <Text size="sm" mt="lg" style={{ whiteSpace: 'pre-line' }}>{inv.notes}</Text>}
      {b?.footer && <Text size="sm" mt="lg" c="dimmed" style={{ whiteSpace: 'pre-line' }}>{b.footer}</Text>}
    </div>
  );
}
