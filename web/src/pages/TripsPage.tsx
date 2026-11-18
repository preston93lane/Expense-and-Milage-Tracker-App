import { Alert, Badge, Button, Group, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconMapPin, IconPlane, IconPlus, IconSparkles } from '@tabler/icons-react';
import { US_STATES } from '@et/core';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Trip, type TripListItem, type TripSuggestion } from '../api';
import { PageHeader } from '../components/bits';
import { money, plural, shortDate, toIso } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

export function useTrips() {
  return useQuery({ queryKey: ['trips'], queryFn: () => api.get<TripListItem[]>('/api/trips') });
}

function dateRange(t: { startDate: string; endDate: string }) {
  return t.startDate === t.endDate ? shortDate(t.startDate) : `${shortDate(t.startDate)} – ${shortDate(t.endDate)}`;
}

function destination(t: { destCity: string | null; destState: string | null }) {
  return [t.destCity, t.destState].filter(Boolean).join(', ');
}

export function TripsPage() {
  const trips = useTrips();
  const suggestions = useQuery({
    queryKey: ['trips', 'suggestions'],
    queryFn: () => api.get<{ homeState: string | null; suggestions: TripSuggestion[] }>('/api/trips/suggestions'),
  });
  const [editing, setEditing] = useState<Partial<Trip> | null>(null);

  return (
    <>
      <PageHeader
        title="Business trips"
        description="Pick the dates and where you went. The app gathers everything you spent there, plus flights, hotels and rental cars booked beforehand and hotel bills that post afterwards — you just untick anything personal."
        right={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing({})}>
            New trip
          </Button>
        }
      />

      {(suggestions.data?.suggestions ?? []).slice(0, 5).map((s) => (
        <Alert key={`${s.state}-${s.startDate}`} color="cyan" variant="light" mb="sm" icon={<IconSparkles size={18} />}>
          <Group justify="space-between" wrap="wrap">
            <Text size="sm">
              Looks like a trip to <b>{s.cities.length ? `${s.cities.slice(0, 3).join(', ')}, ` : ''}{s.state}</b> on{' '}
              {dateRange(s)} — {plural(s.transactionCount, 'purchase')}, {money(-s.totalCents)}.
            </Text>
            <Button
              size="xs"
              onClick={() =>
                setEditing({
                  name: `${s.cities[0] ?? US_STATES[s.state] ?? s.state} trip`,
                  startDate: s.startDate,
                  endDate: s.endDate,
                  destCity: s.cities[0] ?? null,
                  destState: s.state,
                })
              }
            >
              Create this trip
            </Button>
          </Group>
        </Alert>
      ))}
      {suggestions.data && !suggestions.data.homeState && (trips.data?.length ?? 0) === 0 && (
        <Text size="sm" c="dimmed" mb="md">
          Trip suggestions appear once you've imported some card transactions (the app works out your home state from them).
        </Text>
      )}

      <SimpleGrid cols={{ base: 1, md: 2, xl: 3 }}>
        {(trips.data ?? []).map((t) => (
          <Paper key={t.id} withBorder p="md" component={Link} to={`/trips/${t.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Group justify="space-between" align="flex-start">
              <div>
                <Text fw={700}>{t.name}</Text>
                <Text size="sm" c="dimmed">
                  {dateRange(t)}
                </Text>
                {destination(t) && (
                  <Group gap={4} mt={2}>
                    <IconMapPin size={14} color="var(--mantine-color-dimmed)" />
                    <Text size="sm" c="dimmed">
                      {destination(t)}
                    </Text>
                  </Group>
                )}
              </div>
              <IconPlane size={22} color="var(--mantine-color-cyan-7)" />
            </Group>
            <Group mt="md" justify="space-between">
              <Text size="sm">
                {plural(t.totals.count, 'expense')} · <b>{money(t.totals.totalCents)}</b>
              </Text>
              {t.suggestedCount > 0 && (
                <Badge color="orange" variant="light">
                  {t.suggestedCount} to confirm
                </Badge>
              )}
            </Group>
          </Paper>
        ))}
      </SimpleGrid>
      {trips.data?.length === 0 && (
        <Paper withBorder p="xl" ta="center">
          <IconPlane size={36} color="var(--mantine-color-cyan-7)" />
          <Text mt="sm">No trips yet.</Text>
          <Text size="sm" c="dimmed">
            Create one for a work trip — e.g. “Detroit client visit, Oct 12–16”.
          </Text>
        </Paper>
      )}

      {editing && <TripModal initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

const STATE_OPTIONS = Object.entries(US_STATES).map(([value, label]) => ({ value, label: `${label} (${value})` }));

export function TripModal({ initial, onClose }: { initial: Partial<Trip>; onClose: () => void }) {
  const refresh = useRefreshAll();
  const navigate = useNavigate();
  const [name, setName] = useState(initial.name ?? '');
  const [range, setRange] = useState<[string | null, string | null]>([initial.startDate ?? null, initial.endDate ?? null]);
  const [city, setCity] = useState(initial.destCity ?? '');
  const [state, setState] = useState<string | null>(initial.destState ?? null);
  const [purpose, setPurpose] = useState(initial.purpose ?? '');
  const [before, setBefore] = useState<number | string>(initial.beforeDays ?? 60);
  const [after, setAfter] = useState<number | string>(initial.afterDays ?? 5);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name,
        startDate: range[0],
        endDate: range[1] ?? range[0],
        destCity: city,
        destState: state,
        purpose,
        beforeDays: Number(before),
        afterDays: Number(after),
      };
      return initial.id ? api.patch<Trip>(`/api/trips/${initial.id}`, body) : api.post<Trip>('/api/trips', body);
    },
    onSuccess: (t) => {
      refresh();
      onClose();
      if (!initial.id) navigate(`/trips/${t.id}`);
    },
    onError: notifyError,
  });

  return (
    <Modal opened onClose={onClose} title={initial.id ? 'Edit trip' : 'New business trip'} size="lg">
      <Stack>
        <TextInput label="Trip name" placeholder="e.g. Detroit client kickoff" value={name} onChange={(e) => setName(e.currentTarget.value)} data-autofocus />
        <DatePickerInput
          type="range"
          allowSingleDateInRange
          label="Dates you were away"
          placeholder="Pick start and end"
          value={range}
          onChange={(v) => {
            const [a, b] = v as [string | Date | null, string | Date | null];
            setRange([a ? toIso(a)! : null, b ? toIso(b)! : null]);
          }}
        />
        <Group grow>
          <TextInput label="City" placeholder="Detroit" value={city} onChange={(e) => setCity(e.currentTarget.value)} />
          <Select label="State" placeholder="Michigan" searchable clearable data={STATE_OPTIONS} value={state} onChange={setState} />
        </Group>
        <Textarea
          label="Business purpose"
          description="Worth writing down — the IRS expects the purpose of business travel to be recorded."
          placeholder="e.g. On-site kickoff with Acme Corp"
          autosize
          minRows={2}
          value={purpose}
          onChange={(e) => setPurpose(e.currentTarget.value)}
        />
        <Group grow>
          <NumberInput label="Look for bookings up to (days before)" min={0} max={365} value={before} onChange={setBefore} />
          <NumberInput label="Look for late charges up to (days after)" min={0} max={60} value={after} onChange={setAfter} />
        </Group>
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!name.trim() || !range[0]}>
            {initial.id ? 'Save' : 'Create and find expenses'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
