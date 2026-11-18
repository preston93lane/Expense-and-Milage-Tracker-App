import { ActionIcon, Button, Group, NumberInput, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { useState } from 'react';
import type { Transaction } from '../api';
import { money } from '../format';
import { CategorySelect } from './CategorySelect';

interface Line {
  dollars: number;
  classification: 'business' | 'personal' | 'transfer';
  categoryId: number | null;
}

export interface SplitLineInput {
  amountCents: number;
  classification: Line['classification'];
  categoryId: number | null;
}

function initialLines(t: Transaction): Line[] {
  if (t.isSplit && t.splits.length) {
    return t.splits.map((s) => ({ dollars: Math.abs(s.amountCents) / 100, classification: s.classification, categoryId: s.categoryId }));
  }
  const half = Math.round(Math.abs(t.amountCents) / 2) / 100;
  return [
    { dollars: half, classification: 'business', categoryId: t.categoryId },
    { dollars: Math.abs(t.amountCents) / 100 - half, classification: 'personal', categoryId: null },
  ];
}

export function SplitEditor({
  t,
  onSave,
  onCancel,
  saving,
}: {
  t: Transaction;
  onSave: (lines: SplitLineInput[]) => void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [lines, setLines] = useState<Line[]>(() => initialLines(t));
  const sign = t.amountCents < 0 ? -1 : 1;
  const totalCents = Math.abs(t.amountCents);
  const sumCents = lines.reduce((s, l) => s + Math.round((l.dollars || 0) * 100), 0);
  const remaining = totalCents - sumCents;

  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const setBusinessPct = (pct: number) => {
    const biz = Math.round((totalCents * pct) / 100);
    setLines([
      { dollars: biz / 100, classification: 'business', categoryId: lines.find((l) => l.classification === 'business')?.categoryId ?? t.categoryId },
      { dollars: (totalCents - biz) / 100, classification: 'personal', categoryId: null },
    ]);
  };

  return (
    <Stack gap="xs">
      <Group gap={6}>
        <Text size="xs" c="dimmed">
          Quick:
        </Text>
        {[25, 50, 60, 75, 80].map((p) => (
          <Button key={p} size="compact-xs" variant="default" onClick={() => setBusinessPct(p)}>
            {p}% business
          </Button>
        ))}
      </Group>
      {lines.map((l, i) => (
        <Group key={i} gap="xs" wrap="nowrap" align="flex-end">
          <NumberInput
            label={i === 0 ? 'Amount' : undefined}
            prefix="$"
            decimalScale={2}
            fixedDecimalScale
            min={0}
            w={120}
            value={l.dollars}
            onChange={(v) => update(i, { dollars: Number(v) || 0 })}
          />
          <SegmentedControl
            size="xs"
            value={l.classification}
            onChange={(v) => update(i, { classification: v as Line['classification'], categoryId: v === 'business' ? l.categoryId : null })}
            data={[
              { value: 'business', label: 'Business' },
              { value: 'personal', label: 'Personal' },
            ]}
          />
          <CategorySelect
            style={{ flex: 1 }}
            size="xs"
            value={l.categoryId}
            disabled={l.classification !== 'business'}
            onChange={(id) => update(i, { categoryId: id })}
          />
          <ActionIcon variant="subtle" color="gray" disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line">
            <IconTrash size={16} />
          </ActionIcon>
        </Group>
      ))}
      <Group justify="space-between">
        <Button
          size="compact-xs"
          variant="subtle"
          leftSection={<IconPlus size={14} />}
          onClick={() => setLines((ls) => [...ls, { dollars: Math.max(remaining, 0) / 100, classification: 'business', categoryId: null }])}
        >
          Add line
        </Button>
        <Text size="xs" c={remaining === 0 ? 'teal' : 'red'}>
          {remaining === 0 ? `Adds up to ${money(totalCents)}` : `${money(Math.abs(remaining))} ${remaining > 0 ? 'left to assign' : 'too much'}`}
        </Text>
      </Group>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" size="xs" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="xs"
          loading={saving}
          disabled={remaining !== 0}
          onClick={() =>
            onSave(lines.map((l) => ({ amountCents: sign * Math.round(l.dollars * 100), classification: l.classification, categoryId: l.categoryId })))
          }
        >
          Save split
        </Button>
      </Group>
    </Stack>
  );
}
