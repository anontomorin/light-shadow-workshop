import { computeIoU, analyzeOffset, type OffsetHint } from '../projection/SilhouetteMatcher';

/**
 * 通关判定：以 IoU 是否连续达到阈值为依据。
 *
 * 之所以要求"连续两次校验均达标"，是为了避免玩家在拖动过程中
 * 短暂擦过阈值就立刻弹出结算面板。
 */

export type Rank = 'none' | 'complete' | 'excellent' | 'master';

export interface CompletionResult {
  iou: number;
  cleared: boolean;
  rank: Rank;
}

export class CompletionChecker {
  private consecutiveHits = 0;
  private requiredHits: number;

  constructor(requiredHits = 2) {
    this.requiredHits = requiredHits;
  }

  reset(): void {
    this.consecutiveHits = 0;
  }

  /** 每完成一次匹配校验调用一次 */
  evaluate(
    current: Uint8Array,
    target: Uint8Array,
    threshold: number,
    excellent: number,
    master: number,
    moves: number,
    hintsUsed: number,
    recommendedMoves: number,
  ): CompletionResult {
    const iou = computeIoU(current, target);
    if (iou >= threshold) this.consecutiveHits++;
    else this.consecutiveHits = 0;

    const cleared = this.consecutiveHits >= this.requiredHits;
    let rank: Rank = 'none';
    if (cleared) {
      if (iou >= master && hintsUsed === 0 && moves <= recommendedMoves) rank = 'master';
      else if (iou >= excellent && hintsUsed <= 1) rank = 'excellent';
      else rank = 'complete';
    }
    return { iou, cleared, rank };
  }

  /** 仅更新匹配度（用于拖动过程中的高频预览，不触发通关） */
  static scoreOf(current: Uint8Array, target: Uint8Array): number {
    return computeIoU(current, target);
  }

  static offsetOf(current: Uint8Array, target: Uint8Array): OffsetHint {
    return analyzeOffset(current, target);
  }
}
