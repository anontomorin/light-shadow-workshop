import type { LatticeStroke, Vec2Data, WindowDocument } from '../patterns/types';
import { clampNum, dedupePoints, segmentCount } from '../patterns/geometry';
import { COMPLEXITY_LIMITS } from './GeometryLimits';

/**
 * 自绘棂条工具（P1）。
 *
 * 交互约定（对应开发文档 3.3）：
 *   - 在三维视窗里点选节点，形成一条折线；
 *   - 双击或点「完成线条」结束当前折线；
 *   - Esc：折线上已有节点时取消当前折线；折线为空时**退出绘制模式**
 *     （由 onRequestExit 交给上层关闭工具，避免"按了 Esc 还困在绘制里"）；
 *   - 鼠标移动时持续上报悬停点，供界面画"从上一个节点到光标"的预览；
 *   - 可选吸附网格；节点超出窗框时夹紧。
 *
 * 本类只负责"收集点"和"判定合法性"，不负责画界面，
 * 也不直接生成 Mesh —— 完成的折线交给 WorkshopController 追加进文档，
 * 之后走的完全是模板窗棂那一条几何与投影流水线。
 */

export interface DrawingToolOptions {
  /** 把屏幕坐标换算为窗格局部坐标（并做吸附 / 夹紧），返回 null 表示不可用 */
  getLocal: (clientX: number, clientY: number) => Vec2Data | null;
  /** 把窗格局部坐标换算回屏幕坐标（用于把节点画在正确的位置上） */
  toClient: (local: Vec2Data) => Vec2Data;
  /** 预览折线变化（屏幕坐标），供界面画一条临时线 */
  onPreview: (clientPoints: Vec2Data[], segmentCount: number) => void;
  /**
   * 鼠标在窗格上移动（屏幕坐标，已吸附 / 夹紧）。
   * 与 onPreview 分开是有意的：悬停每帧都会变，这条路径只更新浮层，
   * 不会触发整块 HUD 重绘。移出窗格时收到 null。
   */
  onHover: (clientPoint: Vec2Data | null, localPoint: Vec2Data | null) => void;
  /** 一条折线完成；返回 false 表示被复杂度上限拒绝（折线不会进入文档） */
  onComplete: (points: Vec2Data[]) => boolean;
  /** 提示信息（达到上限等） */
  onNotice: (message: string) => void;
  /** 折线为空时按下 Esc：请上层退出绘制模式 */
  onRequestExit: () => void;
}

export class DrawingTool {
  private enabled = false;
  private points: Vec2Data[] = [];
  private clientPoints: Vec2Data[] = [];
  private hoverClient: Vec2Data | null = null;
  private hoverLocal: Vec2Data | null = null;
  /** 当前网格吸附步长，0 表示不吸附 */
  gridStep = 0.1;

  private cleanup: Array<() => void> = [];

  constructor(private opts: DrawingToolOptions) {}

  get isEnabled(): boolean {
    return this.enabled;
  }

  get pointCount(): number {
    return this.points.length;
  }

  get previewPoints(): Vec2Data[] {
    return this.clientPoints.slice();
  }

  /** 当前折线上最后落下的节点（屏幕坐标），没有则为 null */
  get lastClientPoint(): Vec2Data | null {
    return this.clientPoints.length ? this.clientPoints[this.clientPoints.length - 1] : null;
  }

  attach(el: HTMLElement): void {
    this.detach();

    const onPointerDown = (e: PointerEvent) => {
      if (!this.enabled || e.button !== 0) return;
      const local = this.opts.getLocal(e.clientX, e.clientY);
      if (!local) {
        this.opts.onNotice('当前位置无法换算为窗格坐标，请把鼠标移到窗格上。');
        return;
      }
      this.pushPoint(local);
      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!this.enabled) return;
      const local = this.opts.getLocal(e.clientX, e.clientY);
      if (!local) {
        this.setHover(null, null);
        return;
      }
      this.setHover(local, this.opts.toClient(local));
    };

    const onPointerLeave = () => {
      if (!this.enabled) return;
      this.setHover(null, null);
    };

    const onDoubleClick = () => {
      if (!this.enabled) return;
      this.finish();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!this.enabled) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        // 空折线时 Esc 是"退出绘制模式"，而不是无声无息地什么都不做
        if (this.points.length === 0) this.opts.onRequestExit();
        else this.cancel();
        return;
      }
      if (e.key === 'Enter') {
        this.finish();
        e.preventDefault();
      }
    };

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerleave', onPointerLeave);
    el.addEventListener('dblclick', onDoubleClick);
    window.addEventListener('keydown', onKeyDown);
    this.cleanup.push(
      () => el.removeEventListener('pointerdown', onPointerDown),
      () => el.removeEventListener('pointermove', onPointerMove),
      () => el.removeEventListener('pointerleave', onPointerLeave),
      () => el.removeEventListener('dblclick', onDoubleClick),
      () => window.removeEventListener('keydown', onKeyDown),
    );
  }

  detach(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }

  enable(): void {
    this.enabled = true;
    this.cancel();
  }

  disable(): void {
    this.enabled = false;
    this.cancel();
  }

  private setHover(local: Vec2Data | null, client: Vec2Data | null): void {
    const same =
      (local === null) === (this.hoverLocal === null) &&
      (local === null ||
        (Math.abs(this.hoverLocal!.x - local.x) < 1e-6 && Math.abs(this.hoverLocal!.y - local.y) < 1e-6));
    if (same) return;
    this.hoverLocal = local;
    this.hoverClient = client;
    this.opts.onHover(this.hoverClient, this.hoverLocal);
  }

  private pushPoint(local: Vec2Data): void {
    const last = this.points[this.points.length - 1];
    if (last && Math.abs(last.x - local.x) < 1e-4 && Math.abs(last.y - local.y) < 1e-4) return;
    if (this.points.length >= COMPLEXITY_LIMITS.maxUserPointsPerStroke) {
      this.opts.onNotice(`单条笔画最多 ${COMPLEXITY_LIMITS.maxUserPointsPerStroke} 个节点，请双击结束或按 Esc 取消。`);
      return;
    }
    this.points.push(local);
    this.clientPoints.push(this.opts.toClient(local));
    this.emit();
  }

  /** 撤销当前折线的最后一个节点 */
  undoLastPoint(): void {
    if (this.points.length === 0) return;
    this.points.pop();
    this.clientPoints.pop();
    this.emit();
  }

  /**
   * 结束当前折线并提交。
   * @returns 是否真的提交进文档（不足 2 点、或超出复杂度上限时返回 false）
   */
  finish(): boolean {
    const pts = dedupePoints(this.points);
    if (segmentCount(pts) < 1) {
      this.opts.onNotice('一条棂条至少需要两个不同的节点。');
      this.cancel();
      return false;
    }
    const accepted = this.opts.onComplete(pts) !== false;
    this.cancel();
    return accepted;
  }

  /** 放弃当前折线（不清空绘制模式本身，模式开关在 enable / disable） */
  cancel(): void {
    this.points = [];
    this.clientPoints = [];
    this.setHover(null, null);
    this.emit();
  }

  private emit(): void {
    this.opts.onPreview(this.clientPoints.slice(), segmentCount(this.points));
  }

  dispose(): void {
    this.detach();
    this.points = [];
    this.clientPoints = [];
    this.hoverClient = null;
    this.hoverLocal = null;
  }
}

/** 把点吸附到网格（网格步长 ≤ 0 表示不吸附） */
export function snapPoint(p: Vec2Data, step: number): Vec2Data {
  if (!(step > 0)) return { x: p.x, y: p.y };
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/** 把点夹紧到 ±half 范围内（窗格内部） */
export function clampLocalPoint(p: Vec2Data, halfW: number, halfH: number): Vec2Data {
  return {
    x: clampNum(p.x, -halfW, halfW, 0),
    y: clampNum(p.y, -halfH, halfH, 0),
  };
}

/** 构造一条用户笔画 */
export function makeUserStroke(index: number, points: Vec2Data[], width: number): LatticeStroke {
  return {
    id: `user-${index}-${Date.now().toString(36)}`,
    points,
    width,
    role: 'lattice',
    source: 'user',
  };
}

/** 当前文档是否可以被接受（复杂度检查的薄封装） */
export function exceedsUserLimits(doc: WindowDocument): string | null {
  const userStrokes = doc.strokes.filter((s) => s.source === 'user');
  if (userStrokes.length > COMPLEXITY_LIMITS.maxUserStrokes) {
    return `自绘笔画最多 ${COMPLEXITY_LIMITS.maxUserStrokes} 条，当前 ${userStrokes.length} 条。`;
  }
  let segs = 0;
  for (const s of userStrokes) segs += segmentCount(s.points);
  if (segs > COMPLEXITY_LIMITS.maxUserSegments) {
    return `自绘线段最多 ${COMPLEXITY_LIMITS.maxUserSegments} 段，当前 ${segs} 段。`;
  }
  return null;
}
