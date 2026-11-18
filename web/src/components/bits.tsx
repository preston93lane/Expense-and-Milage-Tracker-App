import { Badge, Group, Text, Tooltip, type TextProps } from '@mantine/core';
import { IconRobot, IconRoute, IconSparkles, IconUser } from '@tabler/icons-react';
import type { Transaction } from '../api';
import { money } from '../format';

export function Money({ cents, ...rest }: { cents: number } & TextProps) {
  return (
    <Text component="span" ff="monospace" c={cents > 0 ? 'teal.7' : undefined} style={{ whiteSpace: 'nowrap' }} {...rest}>
      {money(cents)}
    </Text>
  );
}

const CLASS_COLORS: Record<string, string> = { business: 'blue', personal: 'gray', transfer: 'grape' };

export function ClassBadge({ t }: { t: Pick<Transaction, 'classification' | 'status' | 'isSplit'> }) {
  if (t.isSplit) return <Badge color="cyan" variant="light">Split</Badge>;
  if (!t.classification) return <Badge color="orange" variant="dot">Needs review</Badge>;
  const suggested = t.status !== 'reviewed';
  return (
    <Badge color={CLASS_COLORS[t.classification]} variant={suggested ? 'outline' : 'light'}>
      {t.classification}
      {suggested ? '?' : ''}
    </Badge>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  rule: 'Set by one of your rules',
  history: 'Suggested from how you categorised this merchant before',
  keyword: 'Hint from built-in merchant knowledge',
  transfer: 'Looks like a card payment or transfer between your accounts',
  import: 'From your imported history',
  manual: 'Set by you',
  trip: 'Part of a business trip',
};

export function SourceIcon({ source, confidence }: { source: string | null; confidence: number | null }) {
  if (!source) return null;
  const Icon = source === 'manual' ? IconUser : source === 'rule' ? IconRobot : source === 'trip' ? IconRoute : IconSparkles;
  const label = `${SOURCE_LABEL[source] ?? source}${confidence && confidence < 1 ? ` (${Math.round(confidence * 100)}% sure)` : ''}`;
  return (
    <Tooltip label={label} withArrow>
      <Icon size={14} color="var(--mantine-color-dimmed)" aria-label={label} />
    </Tooltip>
  );
}

export function Location({ t }: { t: Pick<Transaction, 'city' | 'state' | 'isOnline'> }) {
  if (!t.state) return null;
  return (
    <Text size="xs" c="dimmed" span>
      {t.isOnline ? 'online · ' : ''}
      {t.city ? `${t.city}, ` : ''}
      {t.state}
    </Text>
  );
}

export function Kbd({ children }: { children: string }) {
  return (
    <Text
      component="kbd"
      size="xs"
      px={6}
      py={1}
      style={{ border: '1px solid currentColor', borderRadius: 4, opacity: 0.7, background: 'transparent', color: 'inherit', lineHeight: 1.4 }}
    >
      {children}
    </Text>
  );
}

export function PageHeader({ title, description, right }: { title: string; description?: string; right?: React.ReactNode }) {
  return (
    <Group justify="space-between" align="flex-start" mb="md" wrap="wrap">
      <div>
        <Text fw={700} fz={24} lh={1.2}>
          {title}
        </Text>
        {description && (
          <Text c="dimmed" size="sm" mt={4} maw={720}>
            {description}
          </Text>
        )}
      </div>
      {right}
    </Group>
  );
}
