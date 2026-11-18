import { Badge, Button, Group, Menu, Modal, Paper, Select, Stack, Table, Text, TextInput } from '@mantine/core';
import { useMutation } from '@tanstack/react-query';
import { IconDots, IconPlus } from '@tabler/icons-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Account, type AccountType } from '../api';
import { PageHeader } from '../components/bits';
import { ACCOUNT_TYPE_LABEL, dateTime, shortDate } from '../format';
import { notifyError, useAccounts, useRefreshAll } from '../hooks';
import { NewAccountModal } from './ImportPage';

export function AccountsPage() {
  const { data } = useAccounts();
  const refresh = useRefreshAll();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | null>(null);
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => api.patch(`/api/accounts/${id}`, body),
    onSuccess: refresh,
    onError: notifyError,
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/api/accounts/${id}`), onSuccess: refresh, onError: notifyError });

  return (
    <>
      <PageHeader
        title="Accounts"
        description="Checking, savings and credit cards you import from. Include personal cards too if you sometimes use them for business."
        right={
          <Button leftSection={<IconPlus size={16} />} onClick={() => setCreating(true)}>
            New account
          </Button>
        }
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={760}>
          <Table fz="sm" verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Account</Table.Th>
                <Table.Th>Type</Table.Th>
                <Table.Th ta="right">Transactions</Table.Th>
                <Table.Th>Latest transaction</Table.Th>
                <Table.Th>Last import</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data ?? []).map((a) => (
                <Table.Tr key={a.id} style={{ opacity: a.archived ? 0.5 : 1 }}>
                  <Table.Td>
                    <Text fw={500} size="sm" component={Link} to={`/transactions?accountId=${a.id}`}>
                      {a.name}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {[a.institution, a.last4 ? `••${a.last4}` : null].filter(Boolean).join(' · ')}
                      {a.hasSavedMapping && (
                        <Badge ml={6} size="xs" variant="light" color="gray">
                          CSV layout saved
                        </Badge>
                      )}
                      {a.archived && (
                        <Badge ml={6} size="xs" color="gray">
                          archived
                        </Badge>
                      )}
                    </Text>
                  </Table.Td>
                  <Table.Td>{ACCOUNT_TYPE_LABEL[a.type]}</Table.Td>
                  <Table.Td ta="right">{a.transactionCount ?? 0}</Table.Td>
                  <Table.Td>{a.lastTransactionDate ? shortDate(a.lastTransactionDate) : '—'}</Table.Td>
                  <Table.Td>{a.lastImportAt ? dateTime(a.lastImportAt) : '—'}</Table.Td>
                  <Table.Td>
                    <Menu position="bottom-end">
                      <Menu.Target>
                        <Button variant="subtle" size="compact-sm" color="gray" aria-label="Account actions">
                          <IconDots size={16} />
                        </Button>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item onClick={() => setEditing(a)}>Edit</Menu.Item>
                        {a.hasSavedMapping && <Menu.Item onClick={() => patch.mutate({ id: a.id, body: { forgetMapping: true } })}>Forget saved CSV layout</Menu.Item>}
                        <Menu.Item onClick={() => patch.mutate({ id: a.id, body: { archived: !a.archived } })}>{a.archived ? 'Unarchive' : 'Archive'}</Menu.Item>
                        {(a.transactionCount ?? 0) === 0 && (
                          <Menu.Item color="red" onClick={() => del.mutate(a.id)}>
                            Delete
                          </Menu.Item>
                        )}
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
              {data?.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={6}>
                    <Text c="dimmed" ta="center" py="lg" size="sm">
                      No accounts yet — they're also created as you import files.
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <NewAccountModal opened={creating} onClose={() => setCreating(false)} onCreated={() => setCreating(false)} />
      {editing && <EditAccount account={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function EditAccount({ account, onClose }: { account: Account; onClose: () => void }) {
  const refresh = useRefreshAll();
  const [name, setName] = useState(account.name);
  const [institution, setInstitution] = useState(account.institution ?? '');
  const [type, setType] = useState<AccountType>(account.type);
  const [last4, setLast4] = useState(account.last4 ?? '');
  const save = useMutation({
    mutationFn: () => api.patch(`/api/accounts/${account.id}`, { name, institution, type, last4 }),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: notifyError,
  });
  return (
    <Modal opened onClose={onClose} title="Edit account">
      <Stack>
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Bank" value={institution} onChange={(e) => setInstitution(e.currentTarget.value)} />
        <Select label="Type" value={type} onChange={(v) => v && setType(v as AccountType)} data={Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }))} />
        <TextInput label="Last 4 digits" value={last4} maxLength={4} onChange={(e) => setLast4(e.currentTarget.value)} />
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
