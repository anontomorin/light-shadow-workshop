import { DIGITAL_MODEL_NOTE } from '../culture/patternCatalog';
import { clampPatternParameters } from '../window-builder/GeometryLimits';
import { divide, frameStrokes, hLine, innerHalf, latticeStroke, vLine } from './common';
import type { GeneratedPattern, LatticeStroke, PatternGenerator, PatternParameters } from './types';

/**
 * 步步锦式（参数化示意）。
 *
 * 构造：外框 → 横、竖分格棂条 → 每个格心内一段「阶梯」折线（按行列奇偶交替方向）。
 * 名称依据见文化资料卡；格心比例属于本项目的参数化示意，不是唯一标准尺寸。
 */
export class StepStepPattern implements PatternGenerator {
  readonly id = 'step-step-brocade' as const;

  generate(raw: PatternParameters): GeneratedPattern {
    const p = clampPatternParameters(raw);
    const { hw, hh } = innerHalf(p);
    const rows = p.rowCount ?? 3;
    const cols = p.columnCount ?? 4;
    const w = p.barWidth;
    const plain = p.variant === 'plain';

    const strokes: LatticeStroke[] = frameStrokes(p);

    const xs = divide(-hw, hw, cols);
    const ys = divide(-hh, hh, rows);

    // 横棂：行分界（去掉落在框上的两端）
    for (let i = 1; i < ys.length - 1; i++) {
      strokes.push(hLine(`h${i}`, ys[i], -hw, hw, w));
    }
    // 竖棂：列分界
    for (let i = 1; i < xs.length - 1; i++) {
      strokes.push(vLine(`v${i}`, xs[i], -hh, hh, w));
    }

    if (!plain) {
      const steps = this.buildSteps(xs, ys, w);
      strokes.push(...steps);
    }

    return {
      strokes,
      label: `步步锦式 · ${rows} 行 ${cols} 列${plain ? ' · 纯格网' : ''}`,
      modelNote: DIGITAL_MODEL_NOTE,
    };
  }

  /** 每个格心内一段两折的「阶梯」线，按 (row+col) 奇偶交替方向 */
  private buildSteps(xs: number[], ys: number[], barWidth: number): LatticeStroke[] {
    const out: LatticeStroke[] = [];
    for (let r = 0; r < ys.length - 1; r++) {
      for (let c = 0; c < xs.length - 1; c++) {
        const x0 = xs[c];
        const x1 = xs[c + 1];
        const y0 = ys[r];
        const y1 = ys[r + 1];
        const d = Math.min(x1 - x0, y1 - y0) * 0.3;
        // 格心太小就不放装饰，避免杆件互相吞没
        if (d < barWidth * 1.6) continue;

        const even = (r + c) % 2 === 0;
        const pts = even
          ? [
              { x: x0 + d, y: y0 + d },
              { x: x1 - d, y: y0 + d },
              { x: x1 - d, y: y1 - d },
            ]
          : [
              { x: x1 - d, y: y1 - d },
              { x: x0 + d, y: y1 - d },
              { x: x0 + d, y: y0 + d },
            ];
        out.push(latticeStroke(`s${r}-${c}`, pts, barWidth));
      }
    }
    return out;
  }
}
