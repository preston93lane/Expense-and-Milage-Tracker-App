import { Group, Paper, Text } from '@mantine/core';
import { useState } from 'react';

export interface HoursSeries {
  name: string;
  color: string;
  values: number[]; // minutes
}

const hrs = (m: number) => `${Math.round((m / 60) * 10) / 10}h`;

/**
 * Stacked weekly bars on one hours axis. Legend above (2+ series), 2px gap
 * between stacked segments, rounded top, hover tooltip per week.
 */
export function HoursChart({ labels, series, height = 220, ariaLabel }: { labels: string[]; series: HoursSeries[]; height?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const width = 560;
  const pad = { l: 40, r: 8, t: 10, b: 26 };
  const n = labels.length;
  if (!n) return null;
  const totals = labels.map((_, i) => series.reduce((s, x) => s + x.values[i], 0));
  const maxH = Math.max(1, ...totals.map((m) => m / 60));
  const step = maxH <= 10 ? 2 : maxH <= 25 ? 5 : maxH <= 60 ? 10 : 20;
  const top = Math.ceil((maxH * 1.08) / step) * step;
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const slot = iw / n;
  const bw = Math.min(28, slot * 0.62);
  const y = (h: number) => pad.t + ih - (h / top) * ih;
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);

  return (
    <div style={{ position: 'relative' }}>
      <Group gap="md" mb={4}>
        {series.map((s) => (
          <Group key={s.name} gap={6}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: s.color }} />
            <Text size="xs">{s.name}</Text>
          </Group>
        ))}
      </Group>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel} style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} stroke="var(--mantine-color-default-border)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={12} fill="var(--mantine-color-dimmed)">
              {t}h
            </text>
          </g>
        ))}
        {labels.map((l, i) => {
          const cx = pad.l + slot * i + slot / 2;
          let base = 0;
          const segs = series
            .map((s) => {
              const h = s.values[i] / 60;
              const seg = { color: s.color, y0: base, y1: base + h };
              base += h;
              return seg;
            })
            .filter((s) => s.y1 > s.y0);
          return (
            <g key={l} onMouseEnter={() => setHover(i)}>
              {/* Hit target: the whole column, bigger than the bar. */}
              <rect x={pad.l + slot * i} y={pad.t} width={slot} height={ih} fill="transparent" />
              {segs.map((s, k) => {
                const isTop = k === segs.length - 1;
                const yTop = y(s.y1);
                const yBot = y(s.y0) - (k > 0 ? 2 : 0); // 2px surface gap between stacked segments
                const h = Math.max(0, yBot - yTop);
                const r = isTop ? Math.min(4, h) : 0;
                return (
                  <path
                    key={k}
                    d={`M${cx - bw / 2},${yBot} V${yTop + r} Q${cx - bw / 2},${yTop} ${cx - bw / 2 + r},${yTop} H${cx + bw / 2 - r} Q${cx + bw / 2},${yTop} ${cx + bw / 2},${yTop + r} V${yBot} Z`}
                    fill={s.color}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                );
              })}
              {(i % Math.max(1, Math.ceil(n / 6)) === 0 || i === n - 1) && (
                <text x={cx} y={height - 8} textAnchor="middle" fontSize={12} fill="var(--mantine-color-dimmed)">
                  {l}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <Paper
          shadow="md"
          withBorder
          p="xs"
          style={{ position: 'absolute', top: 24, left: `${Math.min(80, Math.max(12, ((pad.l + slot * hover + slot / 2) / width) * 100))}%`, transform: 'translateX(-50%)', pointerEvents: 'none', minWidth: 160 }}
        >
          <Text size="xs" c="dimmed">
            Week of {labels[hover]}
          </Text>
          {series.map((s) => (
            <Group key={s.name} gap={6} justify="space-between">
              <Group gap={4}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                <Text size="xs">{s.name}</Text>
              </Group>
              <Text size="xs" ff="monospace" fw={600}>
                {hrs(s.values[hover])}
              </Text>
            </Group>
          ))}
          <Group justify="space-between">
            <Text size="xs">Total</Text>
            <Text size="xs" ff="monospace" fw={600}>
              {hrs(totals[hover])}
            </Text>
          </Group>
        </Paper>
      )}
    </div>
  );
}

/** Horizontal share bars (one series, so no legend — the card title names it). */
export function ShareBars({ rows, color = 'var(--mantine-color-blue-7)' }: { rows: { label: string; minutes: number; pct: number }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.minutes));
  return (
    <div>
      {rows.map((r) => (
        <div key={r.label} title={`${r.label}: ${hrs(r.minutes)} (${r.pct}%)`} style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 34%) 1fr 92px', alignItems: 'center', gap: 8, padding: '3px 0' }}>
          <Text size="sm" truncate>
            {r.label}
          </Text>
          <div style={{ height: 10, background: 'var(--mantine-color-default-hover)', borderRadius: 4 }}>
            <div style={{ width: `${(r.minutes / max) * 100}%`, height: '100%', background: color, borderRadius: 4, minWidth: r.minutes ? 4 : 0 }} />
          </div>
          <Text size="xs" ff="monospace" ta="right">
            {hrs(r.minutes)} · {r.pct}%
          </Text>
        </div>
      ))}
    </div>
  );
}
