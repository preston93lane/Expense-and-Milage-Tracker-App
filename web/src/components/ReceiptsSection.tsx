import { ActionIcon, Anchor, Button, Group, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconPaperclip, IconUnlink, IconUpload } from '@tabler/icons-react';
import { useRef } from 'react';
import { api, filesToPayload, type Receipt, type Transaction } from '../api';
import { money } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

export function useUploadReceipts(transactionId?: number) {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: async (files: File[]) =>
      api.post<{ results: { fileName: string; ok: boolean; duplicate?: boolean; error?: string; receipt?: Receipt }[] }>('/api/receipts', {
        files: await filesToPayload(files),
        transactionId,
      }),
    onSuccess: (r) => {
      refresh();
      const ok = r.results.filter((x) => x.ok);
      const matched = ok.filter((x) => x.receipt?.matchStatus === 'matched').length;
      const failed = r.results.filter((x) => !x.ok);
      notifications.show({
        color: failed.length ? 'orange' : 'teal',
        message: `${ok.length} receipt${ok.length === 1 ? '' : 's'} added${transactionId ? '' : ` · ${matched} matched automatically`}${
          failed.length ? ` · ${failed.map((f) => `${f.fileName}: ${f.error}`).join('; ')}` : ''
        }`,
      });
    },
    onError: notifyError,
  });
}

/** Receipts attached to one transaction, with attach/unlink. */
export function TransactionReceipts({ t, needsReceipt }: { t: Transaction; needsReceipt: boolean }) {
  const refresh = useRefreshAll();
  const { data } = useQuery({
    queryKey: ['receipts', 'tx', t.id],
    queryFn: () => api.get<{ receipts: Receipt[] }>(`/api/receipts?transactionId=${t.id}`),
  });
  const upload = useUploadReceipts(t.id);
  const unlink = useMutation({
    mutationFn: (id: number) => api.post(`/api/receipts/${id}/link`, { transactionId: null }),
    onSuccess: refresh,
    onError: notifyError,
  });
  const ref = useRef<HTMLInputElement>(null);
  const list = data?.receipts ?? [];
  return (
    <Stack gap={4}>
      {list.map((r) => (
        <Group key={r.id} justify="space-between">
          <Anchor href={`/api/receipts/${r.id}/file`} target="_blank" rel="noreferrer" size="sm">
            <Group gap={4}>
              <IconPaperclip size={14} />
              {r.merchant ?? r.fileName}
              {r.totalCents !== null ? ` · ${money(r.totalCents)}` : ''}
            </Group>
          </Anchor>
          <ActionIcon variant="subtle" color="gray" onClick={() => unlink.mutate(r.id)} aria-label="Unlink receipt">
            <IconUnlink size={14} />
          </ActionIcon>
        </Group>
      ))}
      {list.length === 0 && needsReceipt && (
        <Text size="xs" c="orange.8">No receipt yet — the IRS expects one for lodging and for expenses of $75 or more.</Text>
      )}
      <Button size="xs" variant="default" w="fit-content" leftSection={<IconUpload size={14} />} loading={upload.isPending} onClick={() => ref.current?.click()}>
        Attach receipt
      </Button>
      <input
        ref={ref}
        type="file"
        hidden
        multiple
        accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.heic,.eml,.html,.htm,.txt"
        onChange={(e) => {
          const files = [...(e.currentTarget.files ?? [])];
          if (files.length) upload.mutate(files);
          e.currentTarget.value = '';
        }}
      />
    </Stack>
  );
}
