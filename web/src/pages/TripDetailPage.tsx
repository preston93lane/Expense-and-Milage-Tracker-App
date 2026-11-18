import { Alert, Anchor, Badge, Button, Checkbox, Group, Modal, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconArrowLeft, IconCheck, IconMapPin, IconPencil, IconPrinter, IconTrash } from '@tabler/icons-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type TripCandidate, type TripDetail } from '../api';
import { Location, Money } from '../components/bits';
import { CategorySelect } from '../components/CategorySelect';
import { TransactionDrawer } from '../components/TransactionDrawer';
import { money, plural, shortDate } from '../format';
import { notifyError, showUndoToast, useAccountMap, useCategoryMap, useRefreshAll, useUndo } from '../hooks';
import { TripModal } from './TripsPage';

const REASON_TITLE: Record<TripCandidate['reason'], string> = {
  booked_before: 'Booked before the trip',
  during: 'During the trip',
  posted_after: 'Posted after the trip',
};

export function TripDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const refresh = useRefreshAll();
  const undo = useUndo();
  const accounts = useAccountMap();
  const categories = useCategoryMap();
  const { data, isError } = useQuery({ queryKey: ['trips', id], queryFn: () => api.get<TripDetail>(`/api/trips/${id}`) });

  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [cats, setCats] = useState<Record<number, number | null>>({});
  const [assignedSel, setAssignedSel] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [drawerId, setDrawerId] = useState<number | null>(null);

  useEffect(() => {
    if (!data) return;
    setChecked(new Set(data.candidates.filter((c) => c.preselect).map((c) => c.transaction.id)));
    setCats(Object.fromEntries(data.candidates.map((c) => [c.transaction.id, c.suggestedCategoryId])));
    setAssignedSel(new Set());
  }, [data]);

  const groups = useMemo(() => {
    const g: Record<TripCandidate['reason'], TripCandidate[]> = { booked_before: [], during: [], posted_after: [] };
    for (const c of data?.candidates ?? []) g[c.reason].push(c);
    return g;
  }, [data]);

  const selectedTotal = (data?.candidates ?? []).filter((c) => checked.has(c.transaction.id)).reduce((s, c) => s + c.transaction.amountCents, 0);

  const assign = useMutation({
    mutationFn: () =>
      api.post<{ updated: number; actionId: number | null }>(`/api/trips/${id}/assign`, {
        items: [...checked].map((tid) => ({ id: tid, categoryId: cats[tid] ?? null })),
      }),
    onSuccess: (r) => {
      refresh();
      showUndoToast(`${plural(r.updated, 'expense')} added to the trip`, r.actionId, (a) => undo.mutate(a));
    },
    onError: notifyError,
  });
  const remove = useMutation({
    mutationFn: () => api.post<{ updated: number; actionId: number | null }>(`/api/trips/${id}/remove`, { ids: [...assignedSel] }),
    onSuccess: (r) => {
      refresh();
      showUndoToast(`${plural(r.updated, 'expense')} taken off the trip (back to Needs Review)`, r.actionId, (a) => undo.mutate(a));
    },
    onError: notifyError,
  });
  const del = useMutation({
    mutationFn: () => api.del(`/api/trips/${id}`),
    onSuccess: () => {
      refresh();
      navigate('/trips');
    },
    onError: notifyError,
  });

  if (isError) return <Text>Trip not found.</Text>;
  if (!data) return <Text c="dimmed">Loading…</Text>;
  const { trip, totals } = data;
  const dest = [trip.destCity, trip.destState].filter(Boolean).join(', ');

  const toggle = (tid: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(tid)) n.delete(tid);
      else n.add(tid);
      return n;
    });

  return (
    <>
      <Group justify="space-between" mb="md" className="no-print">
        <Button component={Link} to="/trips" variant="subtle" leftSection={<IconArrowLeft size={16} />} px={0}>
          All trips
        </Button>
        <Group gap="xs">
          <Button variant="default" leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
            Print trip report
          </Button>
          <Button variant="default" leftSection={<IconPencil size={16} />} onClick={() => setEditing(true)}>
            Edit
          </Button>
          <Button variant="subtle" color="red" leftSection={<IconTrash size={16} />} onClick={() => setConfirmDelete(true)}>
            Delete
          </Button>
        </Group>
      </Group>

      <Paper withBorder p="lg" mb="lg">
        <Group justify="space-between" align="flex-start" wrap="wrap">
          <div>
            <Title order={2}>{trip.name}</Title>
            <Text c="dimmed">
              {shortDate(trip.startDate)}
              {trip.endDate !== trip.startDate ? ` – ${shortDate(trip.endDate)}` : ''}
            </Text>
            {dest && (
              <Group gap={4} mt={4}>
                <IconMapPin size={16} />
                <Text>{dest}</Text>
              </Group>
            )}
            {trip.purpose ? (
              <Text mt="sm" size="sm">
                <b>Business purpose:</b> {trip.purpose}
              </Text>
            ) : (
              <Text mt="sm" size="sm" c="orange.8" className="no-print">
                Add the business purpose (Edit) — it's part of a good travel record.
              </Text>
            )}
          </div>
          <SimpleGrid cols={2} spacing="lg">
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Spent
              </Text>
              <Text fw={700} fz={24} ff="monospace">
                {money(totals.totalCents)}
              </Text>
            </div>
            <div>
              <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                Deductible
              </Text>
              <Text fw={700} fz={24} ff="monospace">
                {money(totals.deductibleCents)}
              </Text>
            </div>
          </SimpleGrid>
        </Group>
        {totals.byCategory.length > 0 && (
          <Table mt="md" fz="sm" verticalSpacing={4}>
            <Table.Tbody>
              {totals.byCategory.map((c) => (
                <Table.Tr key={String(c.categoryId)}>
                  <Table.Td>
                    {c.name}{' '}
                    <Text span size="xs" c="dimmed">
                      ({c.count})
                    </Text>
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace">
                    {money(c.totalCents)}
                  </Table.Td>
                  <Table.Td ta="right" ff="monospace" c="dimmed">
                    {c.deductibleCents !== c.totalCents ? `${money(c.deductibleCents)} deductible` : ''}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      {data.candidates.length > 0 && (
        <Paper withBorder p="md" mb="lg" className="no-print">
          <Group justify="space-between" mb="xs" wrap="wrap">
            <div>
              <Title order={4}>Possibly part of this trip</Title>
              <Text size="sm" c="dimmed">
                Ticked items look like trip expenses. Untick anything personal, check the categories, then add them.
                {data.homeState && trip.destState && data.homeState !== trip.destState && (
                  <> Spending back home in {data.homeState} is left unticked.</>
                )}
              </Text>
            </div>
            <Button leftSection={<IconCheck size={16} />} disabled={checked.size === 0} loading={assign.isPending} onClick={() => assign.mutate()}>
              Add {plural(checked.size, 'expense')} to trip ({money(selectedTotal)})
            </Button>
          </Group>
          <Stack gap="md">
            {(Object.keys(groups) as TripCandidate['reason'][]).map((reason) =>
              groups[reason].length === 0 ? null : (
                <div key={reason}>
                  <Text fw={600} size="sm" mb={4}>
                    {REASON_TITLE[reason]}
                  </Text>
                  <Table.ScrollContainer minWidth={820}>
                    <Table fz="sm" verticalSpacing={4} highlightOnHover>
                      <Table.Tbody>
                        {groups[reason].map((c) => {
                          const t = c.transaction;
                          return (
                            <Table.Tr key={t.id} style={{ opacity: checked.has(t.id) ? 1 : 0.6 }}>
                              <Table.Td w={36}>
                                <Checkbox checked={checked.has(t.id)} onChange={() => toggle(t.id)} aria-label={`Include ${t.merchant}`} />
                              </Table.Td>
                              <Table.Td w={110} className="nowrap">
                                {shortDate(t.date)}
                              </Table.Td>
                              <Table.Td>
                                <Anchor size="sm" fw={500} onClick={() => setDrawerId(t.id)}>
                                  {t.merchant}
                                </Anchor>
                                <Group gap={6}>
                                  <Location t={t} />
                                  <Text size="xs" c="dimmed">
                                    {accounts.get(t.accountId)?.name}
                                  </Text>
                                </Group>
                              </Table.Td>
                              <Table.Td>
                                <Badge variant="light" color={c.preselect ? 'cyan' : 'gray'} tt="none" fw={500}>
                                  {c.why}
                                </Badge>
                              </Table.Td>
                              <Table.Td w={110} ta="right">
                                <Money cents={t.amountCents} size="sm" />
                              </Table.Td>
                              <Table.Td w={250}>
                                <CategorySelect
                                  size="xs"
                                  value={cats[t.id] ?? null}
                                  onChange={(cid) => setCats((m) => ({ ...m, [t.id]: cid }))}
                                />
                              </Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </div>
              ),
            )}
          </Stack>
        </Paper>
      )}

      <Paper withBorder p="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>Expenses on this trip</Title>
          {assignedSel.size > 0 && (
            <Button size="xs" variant="default" color="red" loading={remove.isPending} onClick={() => remove.mutate()} className="no-print">
              Take {assignedSel.size} off the trip
            </Button>
          )}
        </Group>
        {data.assigned.length === 0 ? (
          <Text size="sm" c="dimmed">
            Nothing added yet.
          </Text>
        ) : (
          <Table fz="sm" verticalSpacing={4}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={36} className="no-print" />
                <Table.Th>Date</Table.Th>
                <Table.Th>Merchant</Table.Th>
                <Table.Th>Category</Table.Th>
                <Table.Th ta="right">Amount</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.assigned.map((t) => (
                <Table.Tr key={t.id}>
                  <Table.Td className="no-print">
                    <Checkbox
                      checked={assignedSel.has(t.id)}
                      onChange={() =>
                        setAssignedSel((s) => {
                          const n = new Set(s);
                          if (n.has(t.id)) n.delete(t.id);
                          else n.add(t.id);
                          return n;
                        })
                      }
                      aria-label={`Select ${t.merchant}`}
                    />
                  </Table.Td>
                  <Table.Td className="nowrap">{shortDate(t.date)}</Table.Td>
                  <Table.Td>
                    <Anchor size="sm" onClick={() => setDrawerId(t.id)}>
                      {t.merchant}
                    </Anchor>{' '}
                    <Location t={t} />
                    {t.notes && (
                      <Text size="xs" c="dimmed">
                        {t.notes}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{t.isSplit ? 'Split' : t.categoryId ? categories.get(t.categoryId)?.name : <Text c="orange" size="sm">No category</Text>}</Table.Td>
                  <Table.Td ta="right">
                    <Money cents={t.amountCents} size="sm" />
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        <Anchor component={Link} to={`/transactions?tripId=${trip.id}`} size="sm" mt="sm" display="block" className="no-print">
          Open in Transactions
        </Anchor>
      </Paper>

      {data.assigned.some((t) => !t.categoryId && !t.isSplit) && (
        <Alert color="yellow" variant="light" mt="md" className="no-print">
          Some trip expenses have no category yet — click them to choose one.
        </Alert>
      )}

      {editing && <TripModal initial={trip} onClose={() => setEditing(false)} />}
      <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this trip?">
        <Text size="sm">
          The trip is removed. Its expenses stay business expenses with their categories — they're just no longer grouped under this trip.
        </Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirmDelete(false)}>
            Cancel
          </Button>
          <Button color="red" loading={del.isPending} onClick={() => del.mutate()}>
            Delete trip
          </Button>
        </Group>
      </Modal>
      <TransactionDrawer id={drawerId} onClose={() => setDrawerId(null)} />
    </>
  );
}
