import type { LatticeStroke, PatternParameters, Vec2Data } from './types';

/**
 * 各生成器共用的构造片段（纯函数，无副作用）。
 */

/** 窗框内边界的半宽 / 半高：棂条应当在这里收口 */
export function innerHalf(p: PatternParameters): { hw: number; hh: number } {
  return {
    hw: Math.max(0.05, p.width / 2 - p.frameWidth),
    hh: Math.max(0.05, p.height / 2 - p.frameWidth),
  };
}

/**
 * 生成四根窗框棂条。
 * 中心线相对窗格外缘内缩 frameWidth/2，因此外缘正好落在 ±width/2、±height/2 上，
 * 窗格的世界尺寸与 WindowDocument.width / height 严格一致。
 */
export function frameStrokes(p: PatternParameters): LatticeStroke[] {
  const f = p.frameWidth;
  const x = Math.max(0.05, p.width / 2 - f / 2);
  const y = Math.max(0.05, p.height / 2 - f / 2);
  const seg = (id: string, a: Vec2Data, b: Vec2Data): LatticeStroke => ({
    id,
    points: [a, b],
    width: f,
    role: 'frame',
    source: 'template',
  });
  return [
    seg('frame-bottom', { x: -x, y: -y }, { x, y: -y }),
    seg('frame-top', { x: -x, y }, { x, y }),
    seg('frame-left', { x: -x, y: -y }, { x: -x, y }),
    seg('frame-right', { x, y: -y }, { x, y }),
  ];
}

/** 生成一根窗心棂条 */
export function latticeStroke(
  id: string,
  points: Vec2Data[],
  width: number,
  role: LatticeStroke['role'] = 'lattice',
): LatticeStroke {
  return { id, points, width, role, source: 'template' };
}

/**
 * 在一段区间上按份数取等分点（含两端）。
 * count 表示"格数"，例如 count = 3 得到 [min, min+1/3, min+2/3, max]。
 */
export function divide(min: number, max: number, count: number): number[] {
  const n = Math.max(1, Math.round(count));
  const out: number[] = [];
  for (let i = 0; i <= n; i++) out.push(min + ((max - min) * i) / n);
  return out;
}

/** 水平线段 */
export function hLine(id: string, y: number, fromX: number, toX: number, width: number): LatticeStroke {
  return latticeStroke(id, [{ x: fromX, y }, { x: toX, y }], width);
}

/** 竖直线段 */
export function vLine(id: string, x: number, fromY: number, toY: number, width: number): LatticeStroke {
  return latticeStroke(id, [{ x, y: fromY }, { x, y: toY }], width);
}
