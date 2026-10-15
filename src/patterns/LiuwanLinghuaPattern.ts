import { DIGITAL_MODEL_NOTE } from '../culture/patternCatalog';
import { clampPatternParameters } from '../window-builder/GeometryLimits';
import { frameStrokes, innerHalf, latticeStroke } from './common';
import { clipSegmentToRect, hexagon } from './geometry';
import type { GeneratedPattern, LatticeStroke, PatternGenerator, PatternParameters, Vec2Data } from './types';

/**
 * 三交六椀菱花式（数字示意）。
 *
 * 形态依据（故宫博物院《三交六椀菱花》词条）：三根棂子在交点处交叉相接，
 * 交点装饰成花心，并有正交 / 斜交等构成方式。
 *
 * 本项目的简化构造：
 *   1. 三个方向（0° / 60° / 120°）的等距线组成三角格网 —— 对应"三交"与菱花格面；
 *   2. 在每个格网点位上放置一个简化六边形 —— 对应交点的"六椀"花心读法；
 *   3. 所有线用窗框内边界裁剪，结果完全由参数决定。
 *
 * 这不是文物精确复原，界面与导出都会标注"数字示意"。
 */
export class LiuwanLinghuaPattern implements PatternGenerator {
  readonly id = 'three-cross-six-bowl-diamond' as const;

  /** 花心数量上限：超过则取一半格点，控制复杂度 */
  private static readonly MAX_FLOWERS = 40;

  generate(raw: PatternParameters): GeneratedPattern {
    const p = clampPatternParameters(raw);
    const { hw, hh } = innerHalf(p);
    const cols = p.columnCount ?? 4;
    const rows = p.rowCount ?? 4;

    // 三个方向等距线组的平行间距 d = s·√3/2；s 取横竖两个方向的较小值
    const sFromCols = (2 * hw) / cols;
    // 竖向：rows 个格面的总高 = rows · (s·√3/2)，令其不超过窗心高度
    const sFromRows = (4 * hh) / (rows * Math.sqrt(3));
    const s = Math.max(0.22, Math.min(sFromCols, sFromRows));
    const d = (s * Math.sqrt(3)) / 2;

    const strokes: LatticeStroke[] = frameStrokes(p);
    const angles = [0, 60, 120];
    let k = 0;
    for (const deg of angles) {
      const th = (deg * Math.PI) / 180;
      const dir = { x: Math.cos(th), y: Math.sin(th) };
      const n = { x: -Math.sin(th), y: Math.cos(th) };
      // 矩形的四个角在法线方向上的投影范围
      const projs = [
        n.x * -hw + n.y * -hh,
        n.x * hw + n.y * -hh,
        n.x * -hw + n.y * hh,
        n.x * hw + n.y * hh,
      ];
      const minD = Math.min(...projs);
      const maxD = Math.max(...projs);
      const m0 = Math.ceil(minD / d);
      const m1 = Math.floor(maxD / d);
      for (let m = m0; m <= m1; m++) {
        const off = m * d;
        const base = { x: n.x * off, y: n.y * off };
        const far = 40;
        const a = { x: base.x - dir.x * far, y: base.y - dir.y * far };
        const b = { x: base.x + dir.x * far, y: base.y + dir.y * far };
        const clipped = clipSegmentToRect(a, b, -hw, hw, -hh, hh);
        if (!clipped) continue;
        if (Math.hypot(clipped[1].x - clipped[0].x, clipped[1].y - clipped[0].y) < 4 * p.barWidth) continue;
        strokes.push(latticeStroke(`t${k++}`, clipped, p.barWidth));
      }
    }

    // ── 花心：0° 线与 60° 线的交点，即三角格网点 ──
    const verts: Array<{ x: number; y: number; kk: number; mm: number }> = [];
    for (let kk = -200; kk <= 200; kk++) {
      const y = kk * d;
      if (y < -hh || y > hh) continue;
      for (let mm = -200; mm <= 200; mm++) {
        const x = (d * (kk - 2 * mm)) / Math.sqrt(3);
        if (x < -hw || x > hw) continue;
        verts.push({ x, y, kk, mm });
      }
    }
    const keepEveryOther = verts.length > LiuwanLinghuaPattern.MAX_FLOWERS;
    const r = Math.min(s * 0.2, 0.42);
    let f = 0;
    for (const v of verts) {
      if (keepEveryOther && (Math.abs(v.kk) + Math.abs(v.mm)) % 2 !== 0) continue;
      if (r < p.barWidth * 1.2) break;
      const hex: Vec2Data[] = hexagon(v.x, v.y, r, 0);
      strokes.push(latticeStroke(`f${f++}`, hex, Math.max(0.45 * p.barWidth, p.barWidth * 0.6), 'lattice'));
    }

    return {
      strokes,
      label: `三交六椀菱花式 · 数字示意 · ${rows}×${cols} 格 · 花心 ${f} 处`,
      modelNote: DIGITAL_MODEL_NOTE,
    };
  }
}
