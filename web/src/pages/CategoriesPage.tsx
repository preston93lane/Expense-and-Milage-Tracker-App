import { Badge, Button, Group, Modal, NumberInput, Paper, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { TAX_LINES, TAX_LINE_BY_CODE } from '@et/core';
import { useState } from 'react';
import { api, type Category } from '../api';
import { PageHeader } from '../components/bits';
import { notifyError, useCategories, useRefreshAll } from '../hooks';

const lineLabel = (code: string) => {
  const l = TAX_LINE_BY_CODE[code];
  if (!l) return code;
  return l.form === 'Tracking' ? l.label : `${l.form}${l.line !== '—' ? ` line ${l.line}` : ''} — ${l.label}`;
};

export function CategoriesPage() {
  const { data } = useCategories();
  useQuery({ queryKey: ['tax-lines'], queryFn: () => api.get('/api/tax-lines') });
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const rows = (data ?? []).filter((c) => showArchived || !c.archived);
  return (
    <>
      <PageHeader
        title="Categories"
        description="Each category is tied to the tax-form line it lands on, so reports add up the way Schedule C expects. Add your own if you like — just pick the line it belongs to."
        right={
          <Group>
            <Switch label="Show archived" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
            <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
              New category
            </Button>
          </Group>
        }
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table fz="sm" verticalSpacing={6} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Category</Table.Th>
                <Table.Th>Goes on</Table.Th>
                <Table.Th ta="right">Deductible</Table.Th>
                <Table.Th ta="right">Used</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((c) => (
                <Table.Tr key={c.id} onClick={() => setEditing(c)} style={{ cursor: 'pointer', opacity: c.archived ? 0.5 : 1 }}>
                  <Table.Td>
                    <Text fw={500} size="sm">
                      {c.name}{' '}
                      {c.kind === 'income' && (
                        <Badge size="xs" color="teal" variant="light">
                          income
                        </Badge>
                      )}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {c.description}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{lineLabel(c.taxLine)}</Text>
                  </Table.Td>
                  <Table.Td ta="right">{c.kind === 'expense' ? `${c.deductiblePct}%` : ''}</Table.Td>
                  <Table.Td ta="right">{c.usageCount ?? 0}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {editing && <CategoryEditor category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryEditor({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const refresh = useRefreshAll();
  const [name, setName] = useState(category?.name ?? '');
  const [kind, setKind] = useState(category?.kind ?? 'expense');
  const [taxLine, setTaxLine] = useState(category?.taxLine ?? 'C-27a');
  const [pct, setPct] = useState<number | string>(category?.deductiblePct ?? 100);
  const [description, setDescription] = useState(category?.description ?? '');
  const save = useMutation({
    mutationFn: (extra: Record<string, unknown> = {}) =>
      category
        ? api.patch(`/api/categories/${category.id}`, { name, kind, taxLine, deductiblePct: Number(pct), description, ...extra })
        : api.post('/api/categories', { name, kind, taxLine, deductiblePct: Number(pct), description }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened onClose={onClose} title={category ? 'Edit category' : 'New category'} size="lg">
      <Stack>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Select
          label="Kind"
          value={kind}
          onChange={(v) => v && setKind(v as Category['kind'])}
          data={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
            { value: 'other', label: 'Tracking only' },
          ]}
        />
        <Select
          label="Tax form line"
          searchable
          value={taxLine}
          onChange={(v) => v && setTaxLine(v)}
          data={TAX_LINES.map((t) => ({ value: t.code, label: lineLabel(t.code) }))}
        />
        {kind === 'expense' && (
          <NumberInput label="Deductible %" description="Meals are usually 50%" min={0} max={100} suffix="%" value={pct} onChange={setPct} />
        )}
        <TextInput label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
        <Group justify="space-between">
          {category ? (
            <Button variant="subtle" color={category.archived ? 'teal' : 'red'} onClick={() => save.mutate({ archived: !category.archived })}>
              {category.archived ? 'Restore' : 'Archive'}
            </Button>
          ) : (
            <span />
          )}
          <Group>
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => save.mutate({})} disabled={!name.trim()} loading={save.isPending}>
              Save
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
