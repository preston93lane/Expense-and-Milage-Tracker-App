import { Group, Paper, Text } from '@mantine/core';
import { useMemo, useRef, useState } from 'react';
import { money } from '../format';

export interface Series {
  name: string;
  color: string;
  values: number[];
}

/**
 * Multi-series line chart on ONE money axis (same unit for every series).
 * Legend above, the last value direct-labelled, hover crosshair + tooltip.
 */
export function LineChart({ labels, series, height = 260, ariaLabel }: { labels: string[]; series: Series[]; height?: number; ariaLabel: string }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 800;
  const pad = { l: 64, r: 90, t: 12, b: 28 };
  const n = labels.length;

  const geom = useMemo(() => {
    const all = series.flatMap((s) => s.values);
    const min = Math.min(0, ...all);
    let max = Math.max(...all, 1);
    max += (max - min) * 0.06;
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
    const step = nice((max - min) / 4);
    const ticks: { v: number; y: number }[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push({ v, y: y(v) });
    return { x, y, ticks };
  }, [series, n, height]);

  if (n === 0) return null;
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * width;
    let best = 0;
    for (let i = 1; i < n; i++) if (Math.abs(geom.x(i) - px) < Math.abs(geom.x(best) - px)) best = i;
    setHover(best);
  };
  const every = Math.max(1, Math.ceil(n / 8));

  return (
    <div style={{ position: 'relative' }}>
      <Group gap="md" mb={4}>
        {series.map((s) => (
          <Group key={s.name} gap={6}>
            <div style={{ width: 14, height: 3, borderRadius: 2, background: s.color }} />
            <Text size="xs">{s.name}</Text>
          </Group>
        ))}
      </Group>
      <svg ref={ref} viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block', overflow: 'visible' }}>
        {geom.ticks.map((t) => (
          <g key={t.v}>
            <line x1={pad.l} x2={width - pad.r} y1={t.y} y2={t.y} stroke="var(--mantine-color-default-border)" />
            <text x={pad.l - 8} y={t.y + 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">
              {compact(t.v)}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={s.values.map((v, i) => `${i ? 'L' : 'M'}${geom.x(i).toFixed(1)},${geom.y(v).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <text x={geom.x(n - 1) + 6} y={geom.y(s.values[n - 1]) + 4} fontSize={11} fill="var(--mantine-color-text)">
              {compact(s.values[n - 1])}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          i % every === 0 || i === n - 1 ? (
            <text key={l} x={geom.x(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">
              {l}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={geom.x(hover)} x2={geom.x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--mantine-color-dimmed)" />
            {series.map((s) => (
              <circle key={s.name} cx={geom.x(hover)} cy={geom.y(s.values[hover])} r={5} fill={s.color} stroke="var(--mantine-color-body)" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hover !== null && (
        <Paper shadow="md" withBorder p="xs" style={{ position: 'absolute', top: 28, left: `${Math.min(75, (geom.x(hover) / width) * 100)}%`, transform: 'translateX(-50%)', pointerEvents: 'none', minWidth: 180 }}>
          <Text size="xs" c="dimmed">{labels[hover]}</Text>
          {series.map((s) => (
            <Group key={s.name} gap={6} justify="space-between">
              <Group gap={4}>
                <div style={{ width: 8, height: 8, borderRadius: 4, background: s.color }} />
                <Text size="xs">{s.name}</Text>
              </Group>
              <Text size="xs" ff="monospace" fw={600}>{money(s.values[hover])}</Text>
            </Group>
          ))}
        </Paper>
      )}
    </div>
  );
}

function nice(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
}

function compact(cents: number): string {
  const d = cents / 100;
  const a = Math.abs(d);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(0)}k` : a.toFixed(0);
  return `${d < 0 ? '-' : ''}$${s}`;
}
