import { MASK_H, MASK_W, WALL_HEIGHT, WALL_WIDTH } from './Projector';
import { boundsOfPolygons, type ProjectionBounds } from './WindowProjector';

/**
 * 投影诊断数据：全部指标都从**真实的投影多边形 / 二值掩码**算出来，
 * 不使用任何写死的数值。界面上的读数和导出的数值来自同一个函数。
 */

/** 单个掩码像素对应的墙面面积（世界单位²） */
export const MASK_PIXEL_AREA = (WALL_WIDTH / MASK_W) * (WALL_HEIGHT / MASK_H);

export interface ProjectionMetrics {
  bounds: ProjectionBounds | null;
  /** 掩码中影子像素数 */
  maskPixels: number;
  /** 影子实际面积（世界单位²） */
  shadowArea: number;
  /** 投影包围盒矩形面积 */
  boundsArea: number;
  /**
   * 镂空率：包围盒面积中没有影子像素的比例。
   * 窗棂镂空越多，该值越高 —— 这是"空隙被真实保留"的量化证据。
   */
  voidRatio: number;
  /** 投影轮廓占墙面宽度的比例 */
  widthRatio: number;
  heightRatio: number;
}

export function computeMetrics(
  polygons: Array<Array<{ x: number; y: number }>>,
  mask: Uint8Array,
): ProjectionMetrics {
  const bounds = boundsOfPolygons(polygons);
  let maskPixels = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) maskPixels++;

  const shadowArea = maskPixels * MASK_PIXEL_AREA;
  const boundsArea = bounds ? bounds.width * bounds.height : 0;
  return {
    bounds,
    maskPixels,
    shadowArea,
    boundsArea,
    voidRatio: boundsArea > 0 ? Math.max(0, 1 - shadowArea / boundsArea) : 0,
    widthRatio: bounds ? bounds.width / WALL_WIDTH : 0,
    heightRatio: bounds ? bounds.height / WALL_HEIGHT : 0,
  };
}

/** 相对变化：与基准比较，返回百分比（基准为 0 时返回 null，避免除零） */
export function relativeChange(current: number, baseline: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(baseline) || Math.abs(baseline) < 1e-9) return null;
  return (current - baseline) / baseline;
}

export interface MetricSnapshot {
  width: number;
  height: number;
  area: number;
}

export function snapshotOf(m: ProjectionMetrics): MetricSnapshot {
  return {
    width: m.bounds?.width ?? 0,
    height: m.bounds?.height ?? 0,
    area: m.shadowArea,
  };
}

export const MASK_SIZE = { width: MASK_W, height: MASK_H };
