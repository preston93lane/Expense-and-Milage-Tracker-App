import { AppShell, Badge, Burger, Group, NavLink, ScrollArea, Text, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useQuery } from '@tanstack/react-query';
import {
  IconBuildingBank,
  IconCategory,
  IconFileImport,
  IconInbox,
  IconLayoutDashboard,
  IconListDetails,
  IconLock,
  IconRobot,
  IconSettings,
} from '@tabler/icons-react';
import { NavLink as RouterLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, type Dashboard } from './api';
import { AccountsPage } from './pages/AccountsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { DashboardPage } from './pages/DashboardPage';
import { ImportPage } from './pages/ImportPage';
import { ReviewPage } from './pages/ReviewPage';
import { RulesPage } from './pages/RulesPage';
import { SettingsPage } from './pages/SettingsPage';
import { TransactionsPage } from './pages/TransactionsPage';

function useReviewCount() {
  const { data } = useQuery({
    queryKey: ['dashboard', 'nav'],
    queryFn: () => api.get<Dashboard>('/api/dashboard'),
  });
  return data ? data.review.unreviewed + data.review.suggested : 0;
}

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const location = useLocation();
  const reviewCount = useReviewCount();

  const links = [
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
    { to: '/rules', label: 'Rules', icon: IconRobot },
    { to: '/categories', label: 'Categories', icon: IconCategory },
    { to: '/accounts', label: 'Accounts', icon: IconBuildingBank },
    { to: '/settings', label: 'Settings & backups', icon: IconSettings },
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
          {links.map((l) => (
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
          <Text size="xs" c="dimmed" px="sm" mt="lg">
            Coming next: business trips, mileage from Google Maps Timeline, tax reports.
          </Text>
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/import" element={<ImportPage />} />
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
