import { MASK_H, MASK_W } from './Projector';

/**
 * 轮廓匹配：以交并比（IoU）评估当前影子与目标轮廓的相似程度。
 *
 *   IoU = |A ∩ B| / |A ∪ B|
 *
 * 掩码基于整个墙面标准区域，因此玩家无法只靠某一小块局部重合蒙混通关。
 */

/** 计算两个二值掩码的 IoU，返回值域 [0, 1] */
export function computeIoU(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 0;
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    if (va || vb) uni++;
    if (va && vb) inter++;
  }
  return uni === 0 ? 0 : inter / uni;
}

/** 掩码中填充的像素数量（用于调试与覆盖率检查） */
export function maskArea(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/**
 * 统计当前影子相对目标轮廓的偏移方向，用于生成“方向性”提示。
 * 返回各方向上的“缺失量”，数值越大说明影子越需要往该方向移动。
 */
export interface OffsetHint {
  dx: number;
  dy: number;
  /** 当前影子面积 / 目标面积，>1 表示影子偏大 */
  scaleRatio: number;
}

export function analyzeOffset(current: Uint8Array, target: Uint8Array): OffsetHint {
  let cx = 0;
  let cy = 0;
  let cn = 0;
  let tx = 0;
  let ty = 0;
  let tn = 0;
  for (let y = 0; y < MASK_H; y++) {
    for (let x = 0; x < MASK_W; x++) {
      const i = y * MASK_W + x;
      if (current[i]) {
        cx += x;
        cy += y;
        cn++;
      }
      if (target[i]) {
        tx += x;
        ty += y;
        tn++;
      }
    }
  }
  if (cn === 0 || tn === 0) {
    return { dx: 0, dy: 0, scaleRatio: cn === 0 ? 0 : 2 };
  }
  // 注意：画布 y 轴向下，dy 为正表示“需要向下移动”
  return {
    dx: (tx / tn - cx / cn) / MASK_W,
    dy: (ty / tn - cy / cn) / MASK_H,
    scaleRatio: cn / tn,
  };
}
