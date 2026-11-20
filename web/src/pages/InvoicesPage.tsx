import { Badge, Button, Group, Paper, SegmentedControl, Table, Text } from '@mantine/core';
import { useMutation, useQuery } from '@tanstack/react-query';
import { IconPlus } from '@tabler/icons-react';
import { Fragment } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, type Invoice } from '../api';
import { PageHeader } from '../components/bits';
import { money, shortDate } from '../format';
import { notifyError, useRefreshAll } from '../hooks';

export const INVOICE_STATE_COLOR: Record<Invoice['state'], string> = {
  draft: 'gray',
  open: 'blue',
  partial: 'cyan',
  overdue: 'red',
  paid: 'teal',
  void: 'gray',
};

export function useLinkPayment() {
  const refresh = useRefreshAll();
  return useMutation({
    mutationFn: ({ invoiceId, transactionId }: { invoiceId: number; transactionId: number }) =>
      api.post<Invoice>(`/api/invoices/${invoiceId}/payments`, { transactionId }),
    onSuccess: refresh,
    onError: notifyError,
  });
}

export function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const state = params.get('state') ?? 'unpaid';
  const { data } = useQuery({ queryKey: ['invoices', state], queryFn: () => api.get<Invoice[]>(`/api/invoices?state=${state === 'all' ? '' : state}`) });
  const link = useLinkPayment();

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Track what you've billed and what's still owed. Make invoices here (print or save as PDF to send), or just record ones you send from elsewhere. When a matching deposit shows up in your bank file, one click marks it paid."
        right={
          <Button component={Link} to="/invoices/new" leftSection={<IconPlus size={16} />}>
            New invoice
          </Button>
        }
      />
      <SegmentedControl
        mb="sm"
        value={state}
        onChange={(v) => setParams({ state: v }, { replace: true })}
        data={[
          { value: 'unpaid', label: 'Unpaid' },
          { value: 'overdue', label: 'Overdue' },
          { value: 'paid', label: 'Paid' },
          { value: 'draft', label: 'Drafts' },
          { value: 'all', label: 'All' },
        ]}
      />
      <Paper withBorder>
        <Table.ScrollContainer minWidth={800}>
          <Table fz="sm" verticalSpacing="xs" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Invoice</Table.Th>
                <Table.Th>Client</Table.Th>
                <Table.Th>Issued</Table.Th>
                <Table.Th>Due</Table.Th>
                <Table.Th ta="right">Total</Table.Th>
                <Table.Th ta="right">Still owed</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(data ?? []).map((inv) => (
                <Fragment key={inv.id}>
                  <Table.Tr style={{ cursor: 'pointer' }} onClick={() => navigate(`/invoices/${inv.id}`)}>
                    <Table.Td fw={500}>{inv.number}</Table.Td>
                    <Table.Td>{inv.clientName}</Table.Td>
                    <Table.Td>{shortDate(inv.issueDate)}</Table.Td>
                    <Table.Td>{inv.dueDate ? shortDate(inv.dueDate) : '—'}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(inv.totalCents)}</Table.Td>
                    <Table.Td ta="right" ff="monospace">{money(inv.balanceCents)}</Table.Td>
                    <Table.Td>
                      <Badge color={INVOICE_STATE_COLOR[inv.state]} variant="light">{inv.state}</Badge>
                    </Table.Td>
                  </Table.Tr>
                  {inv.candidates.slice(0, 1).map((c) => (
                    <Table.Tr key={`${inv.id}-c${c.id}`} bg="var(--mantine-color-teal-light)">
                      <Table.Td colSpan={6}>
                        <Text size="xs">
                          Looks paid: deposit of {money(c.amountCents)} on {shortDate(c.date)} — {c.description}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Button size="compact-xs" onClick={() => link.mutate({ invoiceId: inv.id, transactionId: c.id })}>
                          Mark paid
                        </Button>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Fragment>
              ))}
              {data?.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7}>
                    <Text c="dimmed" ta="center" py="lg" size="sm">Nothing here.</Text>
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </>
  );
}
