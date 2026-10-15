import { clampNum } from '../patterns/geometry';
import type { PatternParameters } from '../patterns/types';

/**
 * 窗格尺寸与复杂度的硬约束。
 *
 * 目的有两个：
 *   1. 保证任何参数输入都不会产生 NaN / 负宽度 / 零长度杆件；
 *   2. 保证构件总数有上界，过密的图案会给出可读提示而不是卡死浏览器。
 */

/** 窗格尺寸范围（世界单位） */
export const WINDOW_LIMITS = {
  minWidth: 1.6,
  maxWidth: 5.0,
  minHeight: 2.2,
  maxHeight: 7.0,
  minFrameWidth: 0.06,
  maxFrameWidth: 0.5,
  minBarWidth: 0.04,
  maxBarWidth: 0.34,
  /** 窗格厚度 */
  minDepth: 0.12,
  maxDepth: 0.6,
};

/** 参数范围 */
export const PARAM_LIMITS = {
  minRowCount: 1,
  maxRowCount: 7,
  minColumnCount: 2,
  maxColumnCount: 7,
  minDensity: 0.35,
  maxDensity: 1,
  minBorderRepeat: 3,
  maxBorderRepeat: 8,
  defaultBorderRepeat: 6,
};

/** 复杂度上限：超过即拒绝重建并提示 */
export const COMPLEXITY_LIMITS = {
  /** 最多笔画（一条折线 = 一笔） */
  maxStrokes: 120,
  /** 单笔最多节点 */
  maxPointsPerStroke: 64,
  /** 全窗最多线段（= 最多杆件数）。开发文档建议 P0 限制在 250–400 之间 */
  maxSegments: 400,
  /** 自绘工具的限制（对应开发文档 3.3） */
  maxUserStrokes: 40,
  maxUserPointsPerStroke: 40,
  maxUserSegments: 120,
};

export const DEFAULT_PARAMETERS: PatternParameters = {
  width: 3.2,
  height: 4.6,
  frameWidth: 0.2,
  barWidth: 0.09,
  rowCount: 4,
  columnCount: 4,
  seed: 20261015,
  density: 0.85,
};

/** 把任意（可能来自存档、UI、外部 JSON）的参数夹紧到合法区间 */
export function clampPatternParameters(input: Partial<PatternParameters>): PatternParameters {
  const d = DEFAULT_PARAMETERS;
  const width = clampNum(input.width, WINDOW_LIMITS.minWidth, WINDOW_LIMITS.maxWidth, d.width!);
  const height = clampNum(input.height, WINDOW_LIMITS.minHeight, WINDOW_LIMITS.maxHeight, d.height!);
  // 外框不得吞掉半个窗格：上限同时受窗格较短边约束
  const frameMax = Math.min(WINDOW_LIMITS.maxFrameWidth, Math.min(width, height) * 0.18);
  const frameWidth = clampNum(input.frameWidth, WINDOW_LIMITS.minFrameWidth, frameMax, Math.min(d.frameWidth!, frameMax));
  const barMax = Math.min(WINDOW_LIMITS.maxBarWidth, Math.min(width, height) * 0.12);
  const barWidth = clampNum(input.barWidth, WINDOW_LIMITS.minBarWidth, barMax, Math.min(d.barWidth!, barMax));

  return {
    width,
    height,
    frameWidth,
    barWidth,
    rowCount: Math.round(clampNum(input.rowCount, PARAM_LIMITS.minRowCount, PARAM_LIMITS.maxRowCount, d.rowCount!)),
    columnCount: Math.round(
      clampNum(input.columnCount, PARAM_LIMITS.minColumnCount, PARAM_LIMITS.maxColumnCount, d.columnCount!),
    ),
    seed: Math.round(clampNum(input.seed, 1, 99999999, d.seed!)),
    density: clampNum(input.density, PARAM_LIMITS.minDensity, PARAM_LIMITS.maxDensity, d.density!),
    variant: typeof input.variant === 'string' ? input.variant.slice(0, 24) : undefined,
    borderEnabled: input.borderEnabled === true,
    borderRepeat: Math.round(
      clampNum(
        input.borderRepeat,
        PARAM_LIMITS.minBorderRepeat,
        PARAM_LIMITS.maxBorderRepeat,
        PARAM_LIMITS.defaultBorderRepeat,
      ),
    ),
  };
}

export interface ComplexityReport {
  strokes: number;
  segments: number;
  /** 是否超出硬上限 */
  overLimit: boolean;
  message: string;
}

/** 统计窗格文档的复杂度并给出可读提示 */
export function inspectComplexity(
  strokes: Array<{ points: Array<{ x: number; y: number }> }>,
): ComplexityReport {
  let segments = 0;
  let maxPoints = 0;
  for (const s of strokes) {
    maxPoints = Math.max(maxPoints, s.points.length);
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1];
      const b = s.points[i];
      if (Math.abs(a.x - b.x) > 1e-4 || Math.abs(a.y - b.y) > 1e-4) segments++;
    }
  }
  const overLimit =
    strokes.length > COMPLEXITY_LIMITS.maxStrokes ||
    segments > COMPLEXITY_LIMITS.maxSegments ||
    maxPoints > COMPLEXITY_LIMITS.maxPointsPerStroke;

  const message = overLimit
    ? `当前图案过于密集（${strokes.length} 笔 / ${segments} 段），已超过 ${COMPLEXITY_LIMITS.maxSegments} 段的显示上限。请减少行列数或降低密度。`
    : '';
  return { strokes: strokes.length, segments, overLimit, message };
}
