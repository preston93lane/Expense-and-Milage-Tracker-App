import { Paper, Text } from '@mantine/core';
import { useMemo, useRef, useState } from 'react';
import { money, shortDate } from '../format';

export interface BalancePoint {
  date: string;
  balanceCents: number;
  inCents?: number;
  outCents?: number;
}

/**
 * Projected balance over time: a single 2px line with a soft area, quiet
 * gridlines, a labelled $0 reference line, and a hover crosshair + tooltip.
 */
export function BalanceChart({ points, height = 240 }: { points: BalancePoint[]; height?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const width = 800;
  const pad = { l: 64, r: 16, t: 12, b: 28 };

  const { xs, ys, yTicks, zeroY, path, area } = useMemo(() => {
    const vals = points.map((p) => p.balanceCents);
    let min = Math.min(0, ...vals);
    let max = Math.max(0, ...vals);
    if (min === max) max = min + 100;
    const span = max - min;
    min -= span * 0.08;
    max += span * 0.08;
    const iw = width - pad.l - pad.r;
    const ih = height - pad.t - pad.b;
    const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
    const y = (v: number) => pad.t + ih - ((v - min) / (max - min)) * ih;
    const xs = points.map((_, i) => x(i));
    const ys = points.map((p) => y(p.balanceCents));
    const step = niceStep((max - min) / 4);
    const ticks: number[] = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
    const path = xs.map((px, i) => `${i ? 'L' : 'M'}${px.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const base = y(Math.max(min, 0));
    const area = xs.length ? `${path} L${xs[xs.length - 1].toFixed(1)},${base.toFixed(1)} L${xs[0].toFixed(1)},${base.toFixed(1)} Z` : '';
    return { xs, ys, yTicks: ticks.map((v) => ({ v, y: y(v) })), zeroY: y(0), path, area };
  }, [points, height]);

  if (points.length === 0) return null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = ref.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * width;
    let best = 0;
    for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - px) < Math.abs(xs[best] - px)) best = i;
    setHover(best);
  };

  const h = hover !== null ? points[hover] : null;
  const labelEvery = Math.max(1, Math.ceil(points.length / 7));

  return (
    <div style={{ position: 'relative' }}>
      <svg
        ref={ref}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label="Projected cash balance by week"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block', overflow: 'visible' }}
      >
        {yTicks.map((t) => (
          <g key={t.v}>
            <line x1={pad.l} x2={width - pad.r} y1={t.y} y2={t.y} stroke="var(--mantine-color-default-border)" strokeWidth={1} />
            <text x={pad.l - 8} y={t.y + 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-dimmed)">
              {compactMoney(t.v)}
            </text>
          </g>
        ))}
        <line x1={pad.l} x2={width - pad.r} y1={zeroY} y2={zeroY} stroke="var(--mantine-color-red-6)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={width - pad.r} y={zeroY - 4} textAnchor="end" fontSize={11} fill="var(--mantine-color-red-7)">
          $0
        </text>
        <path d={area} fill="var(--mantine-color-cyan-6)" fillOpacity={0.12} />
        <path d={path} fill="none" stroke="var(--mantine-color-cyan-7)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={xs[i]} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--mantine-color-dimmed)">
              {p.date.slice(5).replace('-', '/')}
            </text>
          ) : null,
        )}
        {hover !== null && (
          <g pointerEvents="none">
            <line x1={xs[hover]} x2={xs[hover]} y1={pad.t} y2={height - pad.b} stroke="var(--mantine-color-dimmed)" strokeWidth={1} />
            <circle cx={xs[hover]} cy={ys[hover]} r={5} fill="var(--mantine-color-cyan-7)" stroke="var(--mantine-color-body)" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <Paper
          shadow="md"
          withBorder
          p="xs"
          style={{
            position: 'absolute',
            top: 8,
            left: `${Math.min(80, (xs[hover] / width) * 100)}%`,
            transform: 'translateX(-50%)',
            pointerEvents: 'none',
            minWidth: 170,
          }}
        >
          <Text size="xs" c="dimmed">
            Week of {shortDate(h.date)}
          </Text>
          <Text size="sm" fw={700} ff="monospace">
            {money(h.balanceCents)}
          </Text>
          {h.inCents || h.outCents ? (
            <Text size="xs">
              in {money(h.inCents ?? 0)} · out {money(h.outCents ?? 0)}
            </Text>
          ) : null}
        </Paper>
      )}
    </div>
  );
}

function niceStep(raw: number): number {
  const mag = 10 ** Math.floor(Math.log10(Math.max(1, raw)));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

function compactMoney(cents: number): string {
  const d = cents / 100;
  const abs = Math.abs(d);
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10_000 ? 0 : 1)}k` : abs.toFixed(0);
  return `${d < 0 ? '-' : ''}$${s}`;
}
