import { STYLE_MODEL_NOTE } from '../culture/patternCatalog';
import { clampPatternParameters } from '../window-builder/GeometryLimits';
import { divide, frameStrokes, innerHalf, latticeStroke } from './common';
import { makeRng } from './geometry';
import type { GeneratedPattern, LatticeStroke, PatternGenerator, PatternParameters, Vec2Data } from './types';

/**
 * 冰裂纹「风格化」生成器。
 *
 * 构造（完全确定、可按种子复现）：
 *   1. 在窗心区域铺一张 cols × rows 的网格；
 *   2. 网格内部交点按种子做有界抖动（边界点不动，保证贴着窗框）；
 *   3. 每条网格边与每格的一条对角线作为候补线段；
 *   4. 按 density 随机关闭一部分**内部**线段，于是相邻小三角合并成大小不一的格面。
 *
 * 边界声明：这是风格化数字创作，不是对任何园林冰裂纹实物的复原。
 */
export class IceCrackPattern implements PatternGenerator {
  readonly id = 'ice-crack-style' as const;

  /** 抖动幅度占单元格短边的比例（有界，避免产生退化线段） */
  private static readonly JITTER = 0.17;

  generate(raw: PatternParameters): GeneratedPattern {
    const p = clampPatternParameters(raw);
    const { hw, hh } = innerHalf(p);
    const rows = p.rowCount ?? 4;
    const cols = p.columnCount ?? 4;
    const density = p.density ?? 0.85;
    const rng = makeRng(p.seed ?? 1);

    const xs = divide(-hw, hw, cols);
    const ys = divide(-hh, hh, rows);
    const cellW = (2 * hw) / cols;
    const cellH = (2 * hh) / rows;
    const amp = Math.min(cellW, cellH) * IceCrackPattern.JITTER;

    // ── 1. 交点：边界固定，内部抖动 ──
    const pts: Vec2Data[][] = [];
    for (let i = 0; i <= cols; i++) {
      pts.push([]);
      for (let j = 0; j <= rows; j++) {
        const onBoundary = i === 0 || i === cols || j === 0 || j === rows;
        const jx = onBoundary ? 0 : (rng() * 2 - 1) * amp;
        const jy = onBoundary ? 0 : (rng() * 2 - 1) * amp;
        pts[i].push({ x: xs[i] + jx, y: ys[j] + jy });
      }
    }

    // ── 2. 候选线段：网格边 + 每格一条对角线 ──
    interface Cand {
      a: Vec2Data;
      b: Vec2Data;
      /** 贴着窗框的边永不被关闭，保证外轮廓完整 */
      boundary: boolean;
    }
    const cands: Cand[] = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i < cols; i++) {
        cands.push({ a: pts[i][j], b: pts[i + 1][j], boundary: j === 0 || j === rows });
      }
    }
    for (let i = 0; i <= cols; i++) {
      for (let j = 0; j < rows; j++) {
        cands.push({ a: pts[i][j], b: pts[i][j + 1], boundary: i === 0 || i === cols });
      }
    }
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const flip = rng() < 0.5;
        cands.push({
          a: flip ? pts[i][j] : pts[i + 1][j],
          b: flip ? pts[i + 1][j + 1] : pts[i][j + 1],
          boundary: false,
        });
      }
    }

    // ── 3. 按密度保留 ──
    const strokes: LatticeStroke[] = frameStrokes(p);
    let k = 0;
    for (const c of cands) {
      const keep = c.boundary || rng() <= density;
      if (!keep) continue;
      if (Math.abs(c.a.x - c.b.x) < 1e-3 && Math.abs(c.a.y - c.b.y) < 1e-3) continue;
      strokes.push(latticeStroke(`c${k++}`, [{ x: c.a.x, y: c.a.y }, { x: c.b.x, y: c.b.y }], p.barWidth));
    }

    return {
      strokes,
      label: `冰裂纹风格 · ${rows}×${cols} 抖动网格 · 种子 ${p.seed} · 密度 ${Math.round(density * 100)}%`,
      modelNote: STYLE_MODEL_NOTE,
    };
  }
}
