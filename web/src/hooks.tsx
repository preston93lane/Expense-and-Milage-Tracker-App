import { Button, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api, type Account, type ActionEntry, type BulkResult, type Category } from './api';

export function useAccounts() {
  return useQuery({ queryKey: ['accounts'], queryFn: () => api.get<Account[]>('/api/accounts') });
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api.get<Category[]>('/api/categories'), staleTime: 60_000 });
}

export function useCategoryMap() {
  const { data } = useCategories();
  return useMemo(() => new Map((data ?? []).map((c) => [c.id, c])), [data]);
}

export function useAccountMap() {
  const { data } = useAccounts();
  return useMemo(() => new Map((data ?? []).map((a) => [a.id, a])), [data]);
}

/** Invalidate everything that depends on transactions. */
export function useRefreshAll() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['transactions', 'dashboard', 'review', 'accounts', 'categories', 'actions', 'batches', 'rules', 'trips']) {
      void qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function notifyError(e: unknown) {
  notifications.show({ color: 'red', title: 'Something went wrong', message: (e as Error).message });
}

/** Most recent undoable action (used by the U keyboard shortcut). */
export const lastAction: { id: number | null } = { id: null };

export function useUndo() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: (actionId: number) => api.post<{ restored: number }>(`/api/actions/${actionId}/undo`),
    onSuccess: (r) => {
      refresh();
      notifications.show({ color: 'gray', message: `Undone — ${r.restored} restored` });
    },
    onError: notifyError,
  });
}

export function showUndoToast(message: string, actionId: number | null, undo: (id: number) => void) {
  if (actionId) lastAction.id = actionId;
  const id = `action-${actionId ?? Date.now()}`;
  notifications.show({
    id,
    color: 'teal',
    autoClose: 6000,
    message: (
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Text size="sm">{message}</Text>
        {actionId && (
          <Button
            size="compact-xs"
            variant="light"
            onClick={() => {
              undo(actionId);
              notifications.hide(id);
            }}
          >
            Undo
          </Button>
        )}
      </Group>
    ),
  });
}

export interface BulkInput {
  ids?: number[];
  filters?: Record<string, unknown>;
  classification?: 'business' | 'personal' | 'transfer';
  categoryId?: number | null;
  approve?: boolean;
  reset?: boolean;
  notes?: string | null;
  /** Don't show a toast (e.g. inline single edits). */
  quiet?: boolean;
}

export function useBulkUpdate() {
  const refresh = useRefreshAll();
  const undo = useUndo();
  return useMutation({
    mutationFn: ({ quiet: _q, ...input }: BulkInput) => api.post<BulkResult>('/api/transactions/bulk', input),
    onSuccess: (res, input) => {
      refresh();
      if (res.actionId) lastAction.id = res.actionId;
      if (input.quiet) return;
      const learned = res.relearned ? ` · ${res.relearned} similar suggestion${res.relearned === 1 ? '' : 's'} updated` : '';
      showUndoToast(`${res.updated} updated${learned}`, res.actionId, (id) => undo.mutate(id));
    },
    onError: notifyError,
  });
}

export function useActions() {
  return useQuery({ queryKey: ['actions'], queryFn: () => api.get<ActionEntry[]>('/api/actions?limit=30') });
}
