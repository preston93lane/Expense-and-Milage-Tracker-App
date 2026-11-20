import { ActionIcon, Anchor, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconArrowLeft, IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type ClientDetail, type Retainer } from '../api';
import { Money } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useCategoryMap, useRefreshAll } from '../hooks';
import { ClientModal } from './ClientsPage';
import { RETAINER_STATUS_COLOR } from './IncomePage';
import { INVOICE_STATE_COLOR } from './InvoicesPage';

const FREQ_LABEL: Record<string, string> = { weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

export function ClientDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const categories = useCategoryMap();
  const [year, setYear] = useState(new Date().getFullYear());
  const { data } = useQuery({ queryKey: ['clients', 'detail', id, year], queryFn: () => api.get<ClientDetail>(`/api/clients/${id}?year=${year}`) });
  const [editing, setEditing] = useState(false);
  const [retainer, setRetainer] = useState<Partial<Retainer> | null>(null);
  const [projectName, setProjectName] = useState('');

  const addProject = useMutation({
    mutationFn: () => api.post('/api/projects', { name: projectName, clientId: id }),
    onSuccess: () => {
      setProjectName('');
      refresh();
    },
    onError: notifyError,
  });
  const patchProject = useMutation({
    mutationFn: ({ pid, status }: { pid: number; status: string }) => api.patch(`/api/projects/${pid}`, { status }),
    onSuccess: refresh,
    onError: notifyError,
  });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patch(`/api/clients/${id}`, { archived }),
    onSuccess: refresh,
    onError: notifyError,
  });

  if (!data) return <Text c="dimmed">Loading…</Text>;
  const { client } = data;
  const max = Math.max(1, ...data.monthly.map((m) => m.incomeCents));

  return (
    <>
      <Group justify="space-between" mb="md">
        <Button component={Link} to="/clients" variant="subtle" leftSection={<IconArrowLeft size={16} />} px={0}>
          All clients
        </Button>
        <Group gap="xs">
          <Select w={100} value={String(year)} onChange={(v) => v && setYear(Number(v))} data={Array.from({ length: 5 }, (_, i) => String(new Date().getFullYear() - i))} />
          <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="subtle" color="gray" onClick={() => archive.mutate(!client.archived)}>
            {client.archived ? 'Unarchive' : 'Archive'}
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="lg" mb="md">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={2}>{client.name}</Title>
            <Text size="sm" c="dimmed">
              {[client.email, client.phone].filter(Boolean).join(' · ')}
            </Text>
            {client.notes && <Text size="sm" mt={4}>{client.notes}</Text>}
          </div>
          <SimpleGrid cols={3} spacing="xl">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Paid you {year}</Text>
              <Text fw={700} fz={22} ff="monospace" c="teal.7">{money(data.incomeCents)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Spent on them</Text>
              <Text fw={700} fz={22} ff="monospace">{money(data.expenseCents)}</Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>Profit</Text>
              <Text fw={700} fz={22} ff="monospace" c={data.profitCents < 0 ? 'red' : undefined}>{money(data.profitCents)}</Text>
            </div>
          </SimpleGrid>
        </Group>
        <Group gap={4} mt="md" align="flex-end" h={50}>
          {data.monthly.map((m, i) => (
            <div key={m.month} title={`${m.month}: ${money(m.incomeCents)}`} style={{ flex: 1, height: `${(m.incomeCents / max) * 100}%`, minHeight: 2, background: m.incomeCents ? 'var(--mantine-color-teal-5)' : 'var(--mantine-color-default-border)', borderRadius: 2 }} aria-label={`month ${i + 1}`} />
          ))}
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>Invoices</Text>
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => navigate(`/invoices/new?clientId=${id}`)}>
              New invoice
            </Button>
          </Group>
          <Table fz="sm" verticalSpacing={4} highlightOnHover>
            <Table.Tbody>
              {data.invoices.map((inv) => (
                <Table.Tr key={inv.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                  <Table.Td>{inv.number}</Table.Td>
                  <Table.Td>{shortDate(inv.issueDate)}</Table.Td>
                  <Table.Td ta="right" ff="monospace">{money(inv.totalCents)}</Table.Td>
                  <Table.Td><Badge color={INVOICE_STATE_COLOR[inv.state]} variant="light">{inv.state}</Badge></Table.Td>
                </Table.Tr>
              ))}
              {data.invoices.length === 0 && <Table.Tr><Table.Td><Text size="sm" c="dimmed">No invoices.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Paper>

        <Paper withBorder p="md">
          <Group justify="space-between" mb="xs">
            <Text fw={600}>Retainers</Text>
            <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setRetainer({ clientId: id, frequency: 'monthly' })}>
              Add retainer
            </Button>
          </Group>
          {data.retainers.map((r) => (
            <Group key={r.id} justify="space-between" style={{ opacity: r.active ? 1 : 0.5 }}>
              <Text size="sm">
                <b>{r.name}</b> · {money(r.amountCents)} {FREQ_LABEL[r.frequency].toLowerCase()} since {shortDate(r.startDate)}
                {r.endDate ? ` until ${shortDate(r.endDate)}` : ''}
              </Text>
              <ActionIcon variant="subtle" onClick={() => setRetainer(r)} aria-label="Edit retainer"><IconPencil size={14} /></ActionIcon>
            </Group>
          ))}
          {data.schedule.length > 0 && (
            <Table fz="xs" mt="xs" verticalSpacing={2}>
              <Table.Tbody>
                {data.schedule.slice(-12).map((e) => (
                  <Table.Tr key={`${e.retainerId}-${e.dueDate}`}>
                    <Table.Td>{shortDate(e.dueDate)}</Table.Td>
                    <Table.Td>{e.name}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(e.amountCents)}</Table.Td>
                    <Table.Td><Badge size="xs" color={RETAINER_STATUS_COLOR[e.status]} variant="light">{e.status}</Badge></Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          {data.retainers.length === 0 && <Text size="sm" c="dimmed">No retainers. Add one to see when payments are expected and whether they arrived.</Text>}
        </Paper>

        <Paper withBorder p="md">
          <Text fw={600} mb="xs">Projects</Text>
          <Table fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              {data.projects.map((p) => (
                <Table.Tr key={p.id} style={{ opacity: p.status === 'archived' ? 0.5 : 1 }}>
                  <Table.Td>
                    <Anchor component={Link} to={`/transactions?projectId=${p.id}`} size="sm">{p.name}</Anchor>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c="teal.7">{money(p.incomeCents)}</Table.Td>
                  <Table.Td ta="right" ff="monospace">-{money(p.expenseCents)}</Table.Td>
                  <Table.Td>
                    <Select size="xs" w={120} value={p.status} onChange={(v) => v && patchProject.mutate({ pid: p.id, status: v })} data={['active', 'completed', 'archived']} />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Group gap="xs" mt="xs">
            <TextInput size="xs" placeholder="New project name" value={projectName} onChange={(e) => setProjectName(e.currentTarget.value)} />
            <Button size="xs" variant="default" disabled={!projectName.trim()} onClick={() => addProject.mutate()}>Add</Button>
          </Group>
        </Paper>

        <Paper withBorder p="md">
          <Text fw={600} mb="xs">Trips for this client</Text>
          {data.trips.map((t) => (
            <Anchor key={t.id} component={Link} to={`/trips/${t.id}`} size="sm" display="block">
              {t.name} — {shortDate(t.startDate)}
            </Anchor>
          ))}
          {data.trips.length === 0 && <Text size="sm" c="dimmed">None yet. Set the client on a trip to see its profit here.</Text>}
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" mt="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>Transactions tagged {client.name}</Text>
          <Anchor component={Link} to={`/transactions?clientId=${id}`} size="sm">Open in Transactions</Anchor>
        </Group>
        <Table fz="sm" verticalSpacing={4}>
          <Table.Tbody>
            {data.transactions.slice(0, 25).map((t) => (
              <Table.Tr key={t.id}>
                <Table.Td w={110}>{shortDate(t.date)}</Table.Td>
                <Table.Td>{t.merchant}</Table.Td>
                <Table.Td>{t.categoryId ? categories.get(t.categoryId)?.name : ''}</Table.Td>
                <Table.Td ta="right"><Money cents={t.amountCents} size="sm" /></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      {editing && <ClientModal initial={client} onClose={() => setEditing(false)} />}
      {retainer && <RetainerModal initial={retainer} onClose={() => setRetainer(null)} />}
    </>
  );
}

function RetainerModal({ initial, onClose }: { initial: Partial<Retainer>; onClose: () => void }) {
  const refresh = useRefreshAll();
  const [name, setName] = useState(initial.name ?? 'Retainer');
  const [amount, setAmount] = useState<number | string>(initial.amountCents ? initial.amountCents / 100 : '');
  const [frequency, setFrequency] = useState(initial.frequency ?? 'monthly');
  const [start, setStart] = useState(initial.startDate ?? '');
  const [end, setEnd] = useState(initial.endDate ?? '');
  const [active, setActive] = useState(initial.active ?? true);
  const body = () => ({ clientId: initial.clientId, name, amountCents: Math.round(Number(amount) * 100), frequency, startDate: start, endDate: end || null, active });
  const save = useMutation({
    mutationFn: () => (initial.id ? api.patch(`/api/retainers/${initial.id}`, body()) : api.post('/api/retainers', body())),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/retainers/${initial.id}`),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened onClose={onClose} title={initial.id ? 'Edit retainer' : 'New retainer'}>
      <Stack>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <NumberInput label="Amount per payment" prefix="$" decimalScale={2} thousandSeparator min={0} value={amount} onChange={setAmount} />
        <Select label="How often" value={frequency} onChange={(v) => v && setFrequency(v as Retainer['frequency'])} data={Object.entries(FREQ_LABEL).map(([value, label]) => ({ value, label }))} />
        <Group grow>
          <TextInput type="date" label="First payment due" value={start} onChange={(e) => setStart(e.currentTarget.value)} />
          <TextInput type="date" label="Ends (optional)" value={end} onChange={(e) => setEnd(e.currentTarget.value)} />
        </Group>
        <Switch label="Active" checked={active} onChange={(e) => setActive(e.currentTarget.checked)} />
        <Group justify="space-between">
          {initial.id ? (
            <Button variant="subtle" color="red" leftSection={<IconTrash size={14} />} onClick={() => del.mutate()}>Delete</Button>
          ) : <span />}
          <Button onClick={() => save.mutate()} disabled={!amount || !start} loading={save.isPending}>Save</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
