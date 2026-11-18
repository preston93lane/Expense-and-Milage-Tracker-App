import { Select, type SelectProps } from '@mantine/core';
import { useMemo } from 'react';
import type { Category } from '../api';
import { useCategories } from '../hooks';

function groupOf(c: Category): string {
  if (c.kind === 'income') return 'Income';
  if (c.taxLine === 'F8829') return 'Home office (actual method)';
  if (c.taxLine.startsWith('S1-')) return 'Deductions outside Schedule C';
  if (c.kind === 'other' || c.taxLine.startsWith('EST') || c.taxLine === 'NONE') return 'Tracking only';
  return 'Business expenses (Schedule C)';
}

const ORDER = ['Business expenses (Schedule C)', 'Income', 'Deductions outside Schedule C', 'Home office (actual method)', 'Tracking only'];

export function useCategoryOptions(filter?: (c: Category) => boolean) {
  const { data } = useCategories();
  return useMemo(() => {
    const groups = new Map<string, { value: string; label: string }[]>();
    for (const c of data ?? []) {
      if (c.archived || (filter && !filter(c))) continue;
      const g = groupOf(c);
      const list = groups.get(g) ?? [];
      list.push({ value: String(c.id), label: c.name });
      groups.set(g, list);
    }
    return ORDER.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
  }, [data, filter]);
}

interface Props extends Omit<SelectProps, 'value' | 'onChange' | 'data'> {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  /** Show income categories first (for deposits). */
  incomeFirst?: boolean;
}

export function CategorySelect({ value, onChange, incomeFirst, ...rest }: Props) {
  const options = useCategoryOptions();
  const data = useMemo(() => {
    if (!incomeFirst) return options;
    return [...options].sort((a, b) => (a.group === 'Income' ? -1 : b.group === 'Income' ? 1 : 0));
  }, [options, incomeFirst]);
  return (
    <Select
      searchable
      clearable
      placeholder="Category"
      nothingFoundMessage="No matching category"
      comboboxProps={{ withinPortal: true, width: 320, position: 'bottom-start' }}
      maxDropdownHeight={360}
      {...rest}
      data={data}
      value={value ? String(value) : null}
      onChange={(v) => onChange(v ? Number(v) : null)}
    />
  );
}
