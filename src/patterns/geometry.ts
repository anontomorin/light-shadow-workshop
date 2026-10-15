import type { Vec2Data } from './types';

/**
 * 生成器共用的纯几何工具：可复现随机数、矩形裁剪、线段合法性检查。
 * 全部为无副作用的纯函数，便于单元测试。
 */

/** mulberry32：小巧的确定性伪随机数发生器，同一种子必定得到同一序列 */
export function makeRng(seed: number): () => number {
  let a = (Math.floor(seed) || 1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 把任意数值夹紧到 [min, max]，非有限值回退到 fallback */
export function clampNum(v: number | undefined, min: number, max: number, fallback: number): number {
  if (v === undefined || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** 两个点是否在给定精度下重合 */
export function samePoint(a: Vec2Data, b: Vec2Data, eps = 1e-4): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps;
}

/** 去除折线中连续重复的点（含零长度线段），保留其余点序 */
export function dedupePoints(points: Vec2Data[], eps = 1e-4): Vec2Data[] {
  const out: Vec2Data[] = [];
  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (out.length === 0 || !samePoint(out[out.length - 1], p, eps)) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * 用轴对齐矩形裁剪一条线段（Liang–Barsky）。
 * 返回 null 表示线段完全落在矩形外。
 * 用于把三交六椀菱花的斜向长线裁到窗框内。
 */
export function clipSegmentToRect(
  a: Vec2Data,
  b: Vec2Data,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): [Vec2Data, Vec2Data] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - minX, maxX - a.x, a.y - minY, maxY - a.y];

  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
      continue;
    }
    const r = q[i] / p[i];
    if (p[i] < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** 统计折线的有效线段数（相邻不重合点构成一段） */
export function segmentCount(points: Vec2Data[], eps = 1e-4): number {
  let n = 0;
  for (let i = 1; i < points.length; i++) {
    if (!samePoint(points[i - 1], points[i], eps)) n++;
  }
  return n;
}

/** 生成一个六边形（用于花心等小多边形），返回闭合折线（首尾不重复） */
export function hexagon(
  cx: number,
  cy: number,
  r: number,
  rotationDeg = 0,
): Vec2Data[] {
  const out: Vec2Data[] = [];
  const rot = (rotationDeg * Math.PI) / 180;
  for (let i = 0; i < 6; i++) {
    const a = rot + (i / 6) * Math.PI * 2;
    out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return out;
}
