import { Select, type SelectProps } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api, type Client, type Contractor, type Project } from '../api';
import { notifyError, useRefreshAll } from '../hooks';

export function useClients(year?: number) {
  return useQuery({ queryKey: ['clients', year ?? 'current'], queryFn: () => api.get<Client[]>(`/api/clients${year ? `?year=${year}` : ''}`) });
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/api/projects') });
}

export function useContractors(year?: number) {
  return useQuery({
    queryKey: ['contractors', year ?? 'current'],
    queryFn: () => api.get<Contractor[]>(`/api/contractors${year ? `?year=${year}` : ''}`),
  });
}

type Base = Omit<SelectProps, 'value' | 'onChange' | 'data'> & { value: number | null | undefined; onChange: (id: number | null) => void };

/** Select with an inline "+ Add …" option that creates the record from what you typed. */
function CreatableSelect({
  value,
  onChange,
  items,
  createUrl,
  noun,
  ...rest
}: Base & { items: { id: number; name: string; archived?: boolean }[]; createUrl: string; noun: string }) {
  const refresh = useRefreshAll();
  const [search, setSearch] = useState('');
  const create = useMutation({
    mutationFn: (name: string) => api.post<{ id: number }>(createUrl, { name }),
    onSuccess: (r) => {
      refresh();
      onChange(r.id);
      setSearch('');
    },
    onError: notifyError,
  });
  const data = useMemo(() => {
    const base = items.filter((i) => !i.archived || i.id === value).map((i) => ({ value: String(i.id), label: i.name }));
    const typed = search.trim();
    if (typed && !items.some((i) => i.name.toLowerCase() === typed.toLowerCase())) {
      base.push({ value: `__new__${typed}`, label: `+ Add ${noun} “${typed}”` });
    }
    return base;
  }, [items, search, value, noun]);
  return (
    <Select
      searchable
      clearable
      searchValue={search}
      onSearchChange={setSearch}
      nothingFoundMessage={`Type a name to add a ${noun}`}
      comboboxProps={{ withinPortal: true }}
      {...rest}
      data={data}
      value={value ? String(value) : null}
      onChange={(v) => {
        if (v?.startsWith('__new__')) create.mutate(v.slice(7));
        else onChange(v ? Number(v) : null);
      }}
    />
  );
}

export function ClientSelect(props: Base) {
  const { data } = useClients();
  return <CreatableSelect placeholder="Client" {...props} items={data ?? []} createUrl="/api/clients" noun="client" />;
}

export function ContractorSelect(props: Base) {
  const { data } = useContractors();
  return <CreatableSelect placeholder="Contractor" {...props} items={data ?? []} createUrl="/api/contractors" noun="contractor" />;
}

export function ProjectSelect({ clientId, ...props }: Base & { clientId?: number | null }) {
  const { data } = useProjects();
  const items = (data ?? []).filter((p) => !clientId || p.clientId === clientId || p.id === props.value).map((p) => ({ id: p.id, name: p.name, archived: p.status === 'archived' }));
  const refresh = useRefreshAll();
  const [search, setSearch] = useState('');
  const create = useMutation({
    mutationFn: (name: string) => api.post<{ id: number }>('/api/projects', { name, clientId }),
    onSuccess: (r) => {
      refresh();
      props.onChange(r.id);
    },
    onError: notifyError,
  });
  const options = items.filter((i) => !i.archived || i.id === props.value).map((i) => ({ value: String(i.id), label: i.name }));
  if (search.trim() && !items.some((i) => i.name.toLowerCase() === search.trim().toLowerCase())) {
    options.push({ value: `__new__${search.trim()}`, label: `+ Add project “${search.trim()}”` });
  }
  return (
    <Select
      searchable
      clearable
      placeholder="Project"
      searchValue={search}
      onSearchChange={setSearch}
      comboboxProps={{ withinPortal: true }}
      {...props}
      data={options}
      value={props.value ? String(props.value) : null}
      onChange={(v) => {
        if (v?.startsWith('__new__')) create.mutate(v.slice(7));
        else props.onChange(v ? Number(v) : null);
      }}
    />
  );
}
