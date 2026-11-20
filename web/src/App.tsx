import { AppShell, Badge, Burger, Group, NavLink, ScrollArea, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import {
  IconBuildingBank,
  IconCash,
  IconCategory,
  IconFileImport,
  IconFileInvoice,
  IconInbox,
  IconLayoutDashboard,
  IconListDetails,
  IconLock,
  IconPlane,
  IconRobot,
  IconSettings,
  IconUsers,
  IconUserDollar,
  type Icon,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { NavLink as RouterLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, type Dashboard } from './api';
import { AccountsPage } from './pages/AccountsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { ClientDetailPage } from './pages/ClientDetailPage';
import { ClientsPage } from './pages/ClientsPage';
import { ContractorsPage } from './pages/ContractorsPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImportPage } from './pages/ImportPage';
import { IncomePage } from './pages/IncomePage';
import { InvoiceDetailPage } from './pages/InvoiceDetailPage';
import { InvoicesPage } from './pages/InvoicesPage';
import { ReviewPage } from './pages/ReviewPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionsPage } from './pages/TransactionsPage';
import { TripDetailPage } from './pages/TripDetailPage';
import { TripsPage } from './pages/TripsPage';

function useReviewCount() {
  const { data } = useQuery({
    queryKey: ['dashboard', 'nav'],
    queryFn: () => api.get<Dashboard>('/api/dashboard'),
  });
  return data ? data.review.unreviewed + data.review.suggested : 0;
}

interface NavItem {
  to: string;
  label: string;
  icon: Icon;
  right?: ReactNode;
}

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const reviewCount = useReviewCount();

  const sections: { label: string | null; items: NavItem[] }[] = [
    {
      label: null,
      items: [
        { to: '/', label: 'Dashboard', icon: IconLayoutDashboard },
        {
          to: '/review',
          label: 'Needs Review',
          icon: IconInbox,
          right: reviewCount ? (
            <Badge size="sm" color="orange" variant="filled">
              {reviewCount}
            </Badge>
          ) : null,
        },
        { to: '/transactions', label: 'Transactions', icon: IconListDetails },
        { to: '/import', label: 'Import bank files', icon: IconFileImport },
      ],
    },
    {
      label: 'Money in',
      items: [
        { to: '/income', label: 'Income', icon: IconCash },
        { to: '/clients', label: 'Clients', icon: IconUsers },
        { to: '/invoices', label: 'Invoices', icon: IconFileInvoice },
      ],
    },
    {
      label: 'Business',
      items: [
        { to: '/trips', label: 'Business trips', icon: IconPlane },
        { to: '/contractors', label: 'Contractors & 1099s', icon: IconUserDollar },
      ],
    },
    {
      label: 'Setup',
      items: [
        { to: '/rules', label: 'Rules', icon: IconRobot },
        { to: '/categories', label: 'Categories', icon: IconCategory },
        { to: '/accounts', label: 'Accounts', icon: IconBuildingBank },
        { to: '/settings', label: 'Settings & backups', icon: IconSettings },
      ],
    },
  ];

  return (
    <AppShell header={{ height: 52 }} navbar={{ width: 230, breakpoint: 'sm', collapsed: { mobile: !opened } }} padding="md">
      <AppShell.Header className="no-print">
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <img src="/favicon.svg" width={24} height={24} alt="" />
            <Text fw={700}>Expense &amp; Mileage Tracker</Text>
          </Group>
          <Tooltip label="Runs only on this computer. Nothing is sent to the internet." withArrow>
            <Group gap={6} c="dimmed">
              <IconLock size={16} />
              <Text size="sm" visibleFrom="xs">
                Private · local only
              </Text>
            </Group>
          </Tooltip>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs" className="no-print">
        <ScrollArea>
          {sections.map((s) => (
            <div key={s.label ?? 'main'}>
              {s.label && (
                <Text size="xs" c="dimmed" tt="uppercase" fw={700} px="sm" mt="md" mb={4}>
                  {s.label}
                </Text>
              )}
              {s.items.map((l) => (
                <NavLink
                  key={l.to}
                  component={RouterLink}
                  to={l.to}
                  label={l.label}
                  leftSection={<l.icon size={18} stroke={1.6} />}
                  rightSection={l.right}
                  active={l.to === '/' ? location.pathname === '/' : location.pathname.startsWith(l.to)}
                  onClick={close}
                  style={{ borderRadius: 8 }}
                />
              ))}
            </div>
          ))}
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/income" element={<IncomePage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/clients/:id" element={<ClientDetailPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
          <Route path="/trips" element={<TripsPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/contractors" element={<ContractorsPage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<DashboardPage />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
