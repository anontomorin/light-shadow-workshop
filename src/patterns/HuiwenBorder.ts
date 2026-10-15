import { DIGITAL_MODEL_NOTE } from '../culture/patternCatalog';
import { PARAM_LIMITS, clampPatternParameters } from '../window-builder/GeometryLimits';
import { frameStrokes, innerHalf } from './common';
import { clampNum } from './geometry';
import type { GeneratedPattern, LatticeStroke, PatternGenerator, PatternParameters, Vec2Data } from './types';

/**
 * 回纹边饰（辅助装饰模块，P1）。
 *
 * 构造：把同一个「回」形折线单元沿窗框内侧四条边重复排布。
 * 它是边框装饰层，不与步步锦 / 冰裂纹 / 三交六椀菱花作同一类型层级的比较，
 * 也不声称与上述样式有相同的形制来源。
 */

/** 一个「回」单元的归一化折线（内旋方形） */
const HUI_UNIT: Vec2Data[] = [
  { x: 0.15, y: 0.15 },
  { x: 0.85, y: 0.15 },
  { x: 0.85, y: 0.85 },
  { x: 0.15, y: 0.85 },
  { x: 0.15, y: 0.42 },
  { x: 0.55, y: 0.42 },
  { x: 0.55, y: 0.62 },
];

export const HUIWEN_REPEAT_RANGE = {
  min: PARAM_LIMITS.minBorderRepeat,
  max: PARAM_LIMITS.maxBorderRepeat,
  default: PARAM_LIMITS.defaultBorderRepeat,
};

/**
 * 只生成回纹边饰的线段（不含窗框），供其他模板作为装饰层叠加。
 * 每条边上的单元沿该边铺满，单元高度按窗心短边的比例取值。
 */
export function buildHuiwenStrokes(p: PatternParameters, repeat?: number): LatticeStroke[] {
  const { hw, hh } = innerHalf(p);
  const n = Math.round(clampNum(repeat ?? p.borderRepeat, HUIWEN_REPEAT_RANGE.min, HUIWEN_REPEAT_RANGE.max, HUIWEN_REPEAT_RANGE.default));
  const band = Math.max(p.barWidth * 3, Math.min(hw, hh) * 0.3);
  const width = Math.max(0.6 * p.barWidth, Math.min(p.barWidth, band * 0.34));

  const sides: Array<{ o: Vec2Data; d: Vec2Data; n: Vec2Data; len: number; name: string }> = [
    { o: { x: -hw, y: -hh }, d: { x: 1, y: 0 }, n: { x: 0, y: 1 }, len: (2 * hw) / n, name: 'b' },
    { o: { x: hw, y: -hh }, d: { x: 0, y: 1 }, n: { x: -1, y: 0 }, len: (2 * hh) / n, name: 'r' },
    { o: { x: hw, y: hh }, d: { x: -1, y: 0 }, n: { x: 0, y: -1 }, len: (2 * hw) / n, name: 't' },
    { o: { x: -hw, y: hh }, d: { x: 0, y: -1 }, n: { x: 1, y: 0 }, len: (2 * hh) / n, name: 'l' },
  ];

  const out: LatticeStroke[] = [];
  for (const s of sides) {
    for (let i = 0; i < n; i++) {
      const pts = HUI_UNIT.map((u) => ({
        x: s.o.x + s.d.x * (i * s.len + u.x * s.len) + s.n.x * (u.y * band),
        y: s.o.y + s.d.y * (i * s.len + u.x * s.len) + s.n.y * (u.y * band),
      }));
      out.push({ id: `hui-${s.name}${i}`, points: pts, width, role: 'border', source: 'template' });
    }
  }
  return out;
}

export class HuiwenBorder implements PatternGenerator {
  readonly id = 'huiwen-border' as const;

  generate(raw: PatternParameters): GeneratedPattern {
    const p = clampPatternParameters(raw);
    const repeat = Math.round(
      clampNum(p.borderRepeat, HUIWEN_REPEAT_RANGE.min, HUIWEN_REPEAT_RANGE.max, HUIWEN_REPEAT_RANGE.default),
    );
    return {
      strokes: [...frameStrokes(p), ...buildHuiwenStrokes(p, repeat)],
      label: `回纹边饰（辅助模块） · 每边 ${repeat} 个单元`,
      modelNote: DIGITAL_MODEL_NOTE,
    };
  }
}
