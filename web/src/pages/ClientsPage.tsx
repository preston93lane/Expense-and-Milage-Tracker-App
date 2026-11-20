import { Badge, Button, Group, Modal, Paper, Stack, Switch, Table, Text, Textarea, TextInput } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { PageHeader } from '../components/bits';
import { useClients } from '../components/PartySelects';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

export interface ClientForm {
  id?: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  notes: string | null;
}

export function ClientModal({ initial, onClose, onSaved }: { initial: Partial<ClientForm>; onClose: () => void; onSaved?: (id: number) => void }) {
  const refresh = useRefreshAll();
  const [f, setF] = useState<ClientForm>({ name: '', email: null, phone: null, address: null, notes: null, ...initial });
  const set = (k: keyof ClientForm) => (e: { currentTarget: { value: string } }) => setF({ ...f, [k]: e.currentTarget.value });
  const save = useMutation({
    mutationFn: () => (f.id ? api.patch<{ id: number }>(`/api/clients/${f.id}`, f) : api.post<{ id: number }>('/api/clients', f)),
    onSuccess: (r) => {
      refresh();
      onSaved?.(r.id);
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened onClose={onClose} title={f.id ? 'Edit client' : 'New client'}>
      <Stack>
        <TextInput label="Name" value={f.name} onChange={set('name')} data-autofocus />
        <TextInput label="Email" value={f.email ?? ''} onChange={set('email')} />
        <TextInput label="Phone" value={f.phone ?? ''} onChange={set('phone')} />
        <Textarea label="Billing address" autosize minRows={2} value={f.address ?? ''} onChange={set('address')} />
        <Textarea label="Notes" autosize minRows={2} value={f.notes ?? ''} onChange={set('notes')} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={!f.name.trim()} loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function ClientsPage() {
  const year = new Date().getFullYear();
  const { data } = useClients(year);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const rows = (data ?? []).filter((c) => showArchived || !c.archived);
  return (
    <>
      <PageHeader
        title="Clients"
        description="Who pays you. Income, invoices, retainers, trips and expenses can all be tagged to a client to see what each one is worth."
        right={
          <Group>
            <Switch label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setAdding(true)}>
              New client
            </Button>
          </Group>
        }
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={700}>
          <Table highlightOnHover fz="sm" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Client</Table.Th>
                <Table.Th ta="right">Paid you in {year}</Table.Th>
                <Table.Th ta="right">All time</Table.Th>
                <Table.Th ta="right">Owed to you</Table.Th>
                <Table.Th>Last payment</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => (
                <Table.Tr key={c.id} style={{ cursor: 'pointer', opacity: c.archived ? 0.5 : 1 }} onClick={() => navigate(`/clients/${c.id}`)}>
                  <Table.Td>
                    <Text fw={500} size="sm">
                      {c.name}{' '}
                      {c.activeRetainers > 0 && (
                        <Badge size="xs" variant="light">
                          retainer
                        </Badge>
                      )}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {c.email}
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {money(c.yearIncomeCents)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c="dimmed">
                    {money(c.allTimeIncomeCents)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c={c.outstandingCents ? 'orange.8' : 'dimmed'}>
                    {money(c.outstandingCents)}
                  </Table.Td>
                  <Table.Td>{c.lastPaymentDate ? shortDate(c.lastPaymentDate) : '—'}</Table.Td>
                </Table.Tr>
              ))}
              {rows.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={5}>
                    <Text c="dimmed" ta="center" py="lg" size="sm">
                      No clients yet. Add one here, or type a new name in the Client box on any transaction.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {adding && <ClientModal initial={{}} onClose={() => setAdding(false)} onSaved={(id) => navigate(`/clients/${id}`)} />}
    </>
  );
}
