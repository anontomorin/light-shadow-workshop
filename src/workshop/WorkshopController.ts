import * as THREE from 'three';
import type { SceneManager, ViewPreset, ViewState } from '../scene/SceneManager';
import type { StudioScene } from '../scene/StudioScene';
import type { LightController } from '../gameplay/LightController';
import type { LevelControls, Transform3D } from '../gameplay/LevelData';
import { InteractionController } from '../gameplay/InteractionController';
import type { SilhouetteRasterizer } from '../projection/SilhouetteRasterizer';
import { projectWindowBars, projectWindowGroup, representativeRays } from '../projection/WindowProjector';
import { computeMetrics, type ProjectionMetrics } from '../projection/ProjectionDiagnostics';
import type { Point2 } from '../projection/Projector';
import { extractBars } from '../window-builder/WindowGeometryBuilder';
import {
  buildDocumentFromPattern,
  clearDraft,
  cloneDocument,
  regenerateDocument,
  strokeStats,
} from '../window-builder/WindowDocument';
import {
  DrawingTool,
  clampLocalPoint,
  exceedsUserLimits,
  makeUserStroke,
  snapPoint,
} from '../window-builder/DrawingTool';
import type { PatternKind, PatternParameters, WindowDocument } from '../patterns/types';
import type { WorkshopStage } from './WorkshopStage';
import { patternDisplayName } from '../patterns/PatternRegistry';
import { getCultureCard } from '../culture/patternCatalog';
import { WindowEditorHUD, type WorkshopHandlers, type WorkshopView } from '../ui/WindowEditorHUD';
import { GuidedExperiments, EXPERIMENTS, type ExperimentKind } from './GuidedExperiments';
import { deleteArtwork, getArtwork, listArtworks, saveArtwork } from './ArtworkStore';
import { downloadPoster, renderPoster } from './ArtworkExporter';

/**
 * 花窗工坊控制器：把"文档 → 杆件几何 → 真实投影 → 读数 → 界面"这条链路串起来。
 *
 * 数据流（单向）：
 *   WindowDocument（唯一数据源，纯 JSON）
 *     → WorkshopStage 重建杆件 Mesh（显示）
 *     → projectWindowGroup / projectWindowBars 得到投影多边形（判定与读数）
 *     → SilhouetteRasterizer 得到二值掩码（面积 / 镂空率 / 导出海报）
 *     → WindowEditorHUD 渲染读数与参数
 *
 * 显示与读数共用同一份投影结果，因此界面上看到的影子就是用于测量与导出的那个影子。
 */

export interface WorkshopDeps {
  sceneManager: SceneManager;
  studio: StudioScene;
  light: LightController;
  rasterizer: SilhouetteRasterizer;
  /** 返回首页（由 GameApp 负责切换屏幕） */
  onRequestBack: () => void;
  openModal: (el: HTMLElement) => void;
  closeModal: () => void;
}

/** 工坊里只允许整体平移 / 旋转 / 调深度，不做关卡那种"翻转 180°" */
const WORKSHOP_CONTROLS: LevelControls = {
  move: true,
  rotate: true,
  flip: false,
  depth: true,
  light: true,
  lightDistance: true,
};

const HISTORY_LIMIT = 20;

export class WorkshopController implements WorkshopHandlers {
  readonly hud: WindowEditorHUD;

  private deps: WorkshopDeps;
  private stage: WorkshopStage | null = null;
  private interaction: InteractionController;
  private experiments = new GuidedExperiments();
  private drawing: DrawingTool;

  private doc: WindowDocument;
  private transform: Transform3D = { x: 0, y: 5.2, z: 3.6, rotationX: 0, rotationY: 0, rotationZ: 0 };
  private author = '';
  private savedArtworkId: string | null = null;
  private savedLabel = '未保存';
  private notice = '';
  private noticeTimer: number | null = null;

  private polygons: Point2[][] = [];
  private mask: Uint8Array = new Uint8Array(0);
  private metrics: ProjectionMetrics = computeMetrics([], new Uint8Array(0));
  private note = '';
  private selectedStrokeId: string | null = null;

  private raysGroup = new THREE.Group();
  private raysOn = false;
  private assistOn = false;
  private assistBox: THREE.LineSegments | null = null;

  private history: WindowDocument[] = [];
  private future: WindowDocument[] = [];
  private drawSegments = 0;
  private dirty = true;
  private entered = false;
  private modalsOpen = 0;
  private stageReady: Promise<void> | null = null;

  constructor(deps: WorkshopDeps) {
    this.deps = deps;
    this.doc = buildDocumentFromPattern({ patternId: 'step-step-brocade' });
    this.hud = new WindowEditorHUD(this);
    this.drawing = new DrawingTool({
      getLocal: (cx, cy) => this.clientToLocal(cx, cy),
      toClient: (local) => this.localToClient(local),
      onPreview: (pts, segs) => {
        this.hud.setDrawPreview(pts, this.drawBarPx());
        this.drawSegments = segs;
        this.render();
      },
      // 悬停是每帧都会变的轻量路径：只更新浮层，不重绘整块 HUD
      onHover: (client, local) => {
        this.hud.setDrawHover(client, local);
      },
      onComplete: (pts) => this.addUserStroke(pts),
      onNotice: (msg) => this.setNotice(msg),
      onRequestExit: () => this.exitDrawMode('已退出绘制模式。'),
    });
    this.interaction = new InteractionController(this.interactionStage(), deps.sceneManager, WORKSHOP_CONTROLS, {
      onSelect: (id) => this.onSelect(id),
      onChange: (_id, t) => this.onStageTransform(t),
      onCommit: () => this.markDirty(),
    });
  }

  private stageRef(): WorkshopStage {
    if (!this.stage) throw new Error('工坊舞台尚未初始化');
    return this.stage;
  }

  private interactionStage() {
    return {
      getPickables: () => this.stageRef().getPickables(),
      setSelected: (id: string | null) => this.stageRef().setSelected(id),
      getSelected: () => this.stageRef().getSelected(),
      updateTransform: (id: string, t: Transform3D) => this.stageRef().updateTransform(id, t),
    };
  }

  // ───────────────────────── 生命周期 ─────────────────────────

  /** 异步载入舞台实现（避免首屏就加载工坊代码） */
  private async ensureStage(): Promise<void> {
    if (!this.stageReady) {
      this.stageReady = (async () => {
        const { WorkshopStage } = await import('./WorkshopStage');
        const stage = new WorkshopStage();
        this.stage = stage;
        this.deps.studio.root.add(stage.root);
        this.deps.studio.root.add(this.raysGroup);
        stage.setDocument(this.doc);
        stage.setTransform(this.transform);
      })();
    }
    return this.stageReady;
  }

  enter(): void {
    this.entered = true;
    this.deps.studio.projection.setTarget([]);
    this.deps.light.setObjectDepthLimit(this.transform.z);
    this.interaction.setEnabled(true);
    this.deps.sceneManager.setLeftOrbitEnabled(true);
    void this.ensureStage().then(() => {
      if (!this.entered) return;
      const stage = this.stage;
      if (stage && !stage.root.parent) this.deps.studio.root.add(stage.root);
      if (!this.raysGroup.parent) this.deps.studio.root.add(this.raysGroup);
      this.rebuildStage();
      this.deps.light.setObjectDepthLimit(this.transform.z);
      this.deps.light.set(this.deps.light.get());
      this.markDirty(true);
    });
  }

  leave(): void {
    this.entered = false;
    this.drawing.disable();
    this.hud.setDrawOverlayVisible(false);
    this.setRays(false);
    this.assistOn = false;
    this.experiments.cancel();
    this.interaction.setEnabled(false);
    this.deps.studio.projection.setCurrent([]);
    this.raysGroup.clear();
    this.raysGroup.removeFromParent();
    if (this.assistBox) {
      this.assistBox.geometry.dispose();
      this.assistBox = null;
    }
    this.stage?.root.removeFromParent();
    if (this.noticeTimer !== null) {
      window.clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }

  // ───────────────────────── 投影与渲染 ─────────────────────────

  private markDirty(immediate = false): void {
    this.dirty = true;
    if (immediate) this.paint();
  }

  /** 每帧调用：有变化时重算投影、掩码、读数与界面 */
  onFrame(): void {
    if (!this.entered || this.modalsOpen > 0) return;
    if (!this.dirty) return;
    this.dirty = false;
    this.paint();
  }

  private paint(): void {
    const stage = this.stage;
    if (!stage) return;

    // 1) 渲染路径：遍历真实 Mesh + matrixWorld 得到投影多边形
    const proj = projectWindowGroup(stage.root, this.deps.light.get());
    this.polygons = proj.polygons;
    this.note = proj.note;

    // 2) 墙面可视化 + 二值掩码（与关卡同一条栅格化管线）
    this.deps.studio.projection.setCurrent(this.polygons);
    this.mask = this.deps.rasterizer.rasterize(this.polygons);
    this.metrics = computeMetrics(this.polygons, this.mask);

    // 3) 光路辅助线
    if (this.raysOn) this.rebuildRays();
    if (this.assistOn) this.rebuildAssistBox();

    this.render();
  }

  private render(): void {
    const stats = strokeStats(this.doc);
    const experiment = this.experiments.running
      ? this.experiments.observe(this.metrics, this.transform)
      : null;
    const spec = this.experiments.spec;

    const view: WorkshopView = {
      doc: this.doc,
      stats,
      transform: this.transform,
      light: this.deps.light.get(),
      lightLimits: this.deps.light.limits(),
      metrics: this.metrics,
      note: this.note,
      notice: this.notice,
      drawing: this.drawing.isEnabled,
      drawSegments: this.drawSegments,
      drawNodes: this.drawing.pointCount,
      snap: this.drawing.gridStep > 0,
      selectedStrokeId: this.selectedStrokeId,
      author: this.author,
      savedLabel: this.savedLabel,
      raysOn: this.raysOn,
      assistOn: this.assistOn,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
      experiment: {
        running: this.experiments.running,
        kind: this.experiments.kind,
        title: spec?.title ?? '',
        narrative: experiment?.narrative ?? '',
        steps: spec?.steps ?? [],
        conclusion: experiment ? '' : this.experiments.conclusion(),
      },
    };
    this.hud.render(view);
  }

  // ───────────────────────── 文档重建 ─────────────────────────

  private rebuildStage(): void {
    const stage = this.stageRef();
    stage.setDocument(this.doc);
    stage.setTransform(this.transform);
    this.interaction.syncTransforms(stage.transformsForAllStrokes());
    // 选中态：优先保留原来的，否则选第一根非窗框的棂条
    const keep = this.selectedStrokeId && this.doc.strokes.some((s) => s.id === this.selectedStrokeId);
    const fallback =
      this.doc.strokes.find((s) => s.role === 'lattice')?.id ?? this.doc.strokes[0]?.id ?? null;
    this.selectedStrokeId = keep ? this.selectedStrokeId : fallback;
    stage.setSelected(this.selectedStrokeId);
    this.interaction.select(this.selectedStrokeId);
    if (this.assistOn) this.rebuildAssistBox();
  }

  private pushHistory(): void {
    this.history.push(cloneDocument(this.doc));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future = [];
  }

  /** 文档变化后的统一收尾：重建几何、重算投影、清空保存状态提示 */
  private applyDocChange(next: WindowDocument, historyLabel?: string): void {
    if (historyLabel) this.pushHistory();
    this.dropStalePolyline();
    this.doc = next;
    this.savedLabel = this.savedArtworkId ? '有改动未保存' : '未保存';
    void this.ensureStage().then(() => {
      this.rebuildStage();
      this.markDirty(true);
    });
  }

  /**
   * 窗格本身被换掉（换模板 / 改参数 / 撤销重做 / 打开作品）时，正在画的折线坐标就失效了：
   * 节点是按**当时**的窗格尺寸夹紧的，而窗格现在是另一扇。与其提交一条跑到框外的棂条，
   * 不如直接取消并说明原因（只在真有未提交节点时才提示，避免拖滑杆时刷屏）。
   */
  private dropStalePolyline(): void {
    if (!this.drawing.isEnabled || this.drawing.pointCount === 0) return;
    this.drawing.cancel();
    this.setNotice('窗格已变化，未提交的折线已取消（不会进入文档）。');
  }

  // ───────────────────────── WorkshopHandlers 实现 ─────────────────────────

  onBack(): void {
    this.deps.closeModal();
    this.leave();
    this.deps.onRequestBack();
  }

  onPickPattern(id: PatternKind): void {
    this.pushHistory();
    const params: Partial<PatternParameters> = {
      ...this.doc.parameters,
      borderEnabled: this.doc.parameters.borderEnabled,
    };
    this.applyDocChange(
      buildDocumentFromPattern({ patternId: id, parameters: params, name: patternDisplayName(id) }),
    );
    this.setNotice(`已切换到「${patternDisplayName(id)}」。`);
  }

  onParamChange(patch: Partial<PatternParameters>): void {
    const next = regenerateDocument(this.doc, patch);
    this.applyDocChange(next);
  }

  onTransformChange(patch: Partial<Transform3D>): void {
    this.setTransform({ ...this.transform, ...patch }, true);
  }

  private setTransform(t: Transform3D, fromUi: boolean): void {
    this.transform = t;
    const stage = this.stage;
    if (stage) {
      stage.setTransform(t);
      this.interaction.syncTransforms(stage.transformsForAllStrokes());
    }
    // 光源必须比窗格更靠近 +Z 端
    this.deps.light.setObjectDepthLimit(t.z);
    if (fromUi) this.deps.light.set(this.deps.light.get());
    this.markDirty(true);
  }

  private onStageTransform(t: Transform3D): void {
    this.transform = t;
    this.deps.light.setObjectDepthLimit(t.z);
    this.deps.light.set(this.deps.light.get());
    this.markDirty();
  }

  onLightChange(axis: 'x' | 'y' | 'z', v: number): void {
    this.deps.light.setAxis(axis, v);
    this.markDirty(true);
  }

  onRestoreTemplate(): void {
    const card = getCultureCard(this.doc.patternId);
    this.pushHistory();
    this.applyDocChange(
      buildDocumentFromPattern({
        patternId: this.doc.patternId === 'custom' ? 'blank' : this.doc.patternId,
        parameters: this.doc.parameters,
        name: this.doc.name,
        id: this.doc.id,
        createdAt: this.doc.createdAt,
      }),
    );
    this.setNotice(`已恢复「${card?.title ?? '当前模板'}」的默认构造。`);
  }

  onClearDraft(): void {
    this.pushHistory();
    this.applyDocChange({ ...clearDraft(this.doc), parameters: { ...this.doc.parameters } });
    this.setNotice('已清空窗心草稿，只保留窗框。可用「恢复当前模板」重建。');
  }

  onDeleteStroke(): void {
    if (!this.selectedStrokeId) {
      this.setNotice('请先在画布里点选一根棂条。');
      return;
    }
    const target = this.doc.strokes.find((s) => s.id === this.selectedStrokeId);
    if (!target) return;
    if (target.role === 'frame') {
      this.setNotice('窗框是窗格的基础构件，不能删除。');
      return;
    }
    this.pushHistory();
    const next: WindowDocument = {
      ...this.doc,
      strokes: this.doc.strokes.filter((s) => s.id !== this.selectedStrokeId),
      updatedAt: new Date().toISOString(),
    };
    this.selectedStrokeId = null;
    this.applyDocChange(next);
    this.setNotice('已删除选中的构件。');
  }

  onUndoStroke(): void {
    const userStrokes = this.doc.strokes.filter((s) => s.source === 'user');
    if (userStrokes.length === 0) {
      this.setNotice('当前没有自绘笔画可以撤销。');
      return;
    }
    const last = userStrokes[userStrokes.length - 1];
    this.pushHistory();
    this.applyDocChange({ ...this.doc, strokes: this.doc.strokes.filter((s) => s.id !== last.id) });
    this.setNotice('已撤销上一条自绘笔画。');
  }

  onUndo(): void {
    const prev = this.history.pop();
    if (!prev) return;
    this.future.push(cloneDocument(this.doc));
    this.dropStalePolyline();
    this.doc = prev;
    void this.ensureStage().then(() => {
      this.rebuildStage();
      this.markDirty(true);
    });
    this.setNotice('已撤销一步设计操作。');
  }

  onRedo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.history.push(cloneDocument(this.doc));
    this.dropStalePolyline();
    this.doc = next;
    void this.ensureStage().then(() => {
      this.rebuildStage();
      this.markDirty(true);
    });
    this.setNotice('已重做一步设计操作。');
  }

  /**
   * 「画棂条」按钮：进入 / 退出绘制模式。
   *
   * 这里曾经有一个真实 bug：退出分支只调用了 `setDrawMode(false)`，
   * 却**没有** `drawing.disable()`，于是 `drawing.isEnabled` 永远停在 true——
   * 按钮文案因此卡在「结束绘制」，画布上的点击还在偷偷往折线里塞节点
   * （浮层已经隐藏，用户看不到），并且 `hitTest()` 因 `drawing.isEnabled`
   * 直接返回 false，窗格再也点不中。现在的退出只有一条路径（exitDrawMode），
   * 保证工具状态、浮层、交互开关三者一起回到关闭态。
   */
  onToggleDraw(): void {
    if (this.drawing.isEnabled) {
      const committed = this.drawing.pointCount >= 2 ? this.drawing.finish() : false;
      this.exitDrawMode(committed ? '已结束当前折线并退出绘制模式。' : '已退出绘制模式。');
      return;
    }
    this.drawing.enable();
    this.drawing.attach(this.hud.stageEl);
    this.setDrawMode(true);
    this.setNotice('绘制模式：在窗格上单击添加节点；双击或 Enter 结束线条；Esc 取消当前折线（折线为空时退出绘制）。');
    this.render();
  }

  /** 退出绘制模式的唯一入口：工具、浮层、交互开关必须一起关 */
  private exitDrawMode(message: string): void {
    this.drawing.disable();
    this.setDrawMode(false);
    this.setNotice(message);
    this.render();
  }

  private setDrawMode(on: boolean): void {
    this.hud.setDrawOverlayVisible(on);
    this.interaction.setEnabled(!on);
    this.deps.sceneManager.setLeftOrbitEnabled(!on);
    if (!on) {
      this.hud.setDrawPreview([]);
      this.drawSegments = 0;
    }
  }

  /** 屏幕上 1 个棂条宽对应多少像素 —— 用于把预览画成"真实粗细的棂条" */
  private drawBarPx(): number {
    const a = this.localToClient({ x: 0, y: 0 });
    const b = this.localToClient({ x: Math.max(this.doc.barWidth, 0.02), y: 0 });
    return Math.min(140, Math.max(1.5, Math.hypot(b.x - a.x, b.y - a.y)));
  }

  onFinishLine(): void {
    this.drawing.finish();
    this.render();
  }

  onUndoLastNode(): void {
    this.drawing.undoLastPoint();
    this.render();
  }

  onToggleSnap(v: boolean): void {
    this.drawing.gridStep = v ? 0.1 : 0;
    this.setNotice(v ? '已开启网格吸附（0.1 世界单位）。' : '已关闭网格吸附。');
    this.render();
  }

  onNameChange(v: string): void {
    this.doc = { ...this.doc, name: v.slice(0, 40) };
    this.savedLabel = this.savedArtworkId ? '有改动未保存' : '未保存';
  }

  onAuthorChange(v: string): void {
    this.author = v.slice(0, 24);
    this.savedLabel = this.savedArtworkId ? '有改动未保存' : '未保存';
  }

  onSave(): void {
    this.save(this.savedArtworkId);
  }

  onSaveAs(): void {
    this.save(null);
  }

  private save(id: string | null): void {
    const result = saveArtwork({
      id,
      name: this.doc.name || '未命名作品',
      author: this.author,
      doc: this.doc,
      transform: this.transform,
      light: this.deps.light.get(),
      colors: { wall: '#fdf9f1', ink: '#31455a' },
    });
    if (result.ok) {
      this.savedArtworkId = result.id;
      this.savedLabel = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
      this.setNotice(id ? '作品已更新保存。' : '已另存为新作品，可在「作品集」中重新打开。');
    } else {
      this.savedLabel = '保存失败';
      this.setNotice(result.message);
    }
    this.render();
  }

  onExport(): void {
    void (async () => {
      const input = this.posterInput();
      const result = await downloadPoster(input);
      if (result.ok) {
        this.setNotice(`海报已导出：${result.fileName}（1920×1080，窗影来自当前真实投影）。`);
      } else {
        this.setNotice(result.message);
      }
      this.render();
    })();
  }

  private posterInput() {
    const p = this.doc.parameters;
    const parameterLines = [
      `窗格 ${this.doc.width.toFixed(2)} × ${this.doc.height.toFixed(2)}　外框 ${this.doc.frameWidth.toFixed(2)}　棂条 ${this.doc.barWidth.toFixed(2)}`,
      `行列 ${p.rowCount ?? '-'} × ${p.columnCount ?? '-'}　种子 ${p.seed ?? '-'}　深度 ${this.transform.z.toFixed(2)}`,
    ];
    const card = getCultureCard(this.doc.patternId === 'custom' ? 'blank' : this.doc.patternId);
    return {
      doc: this.doc,
      polygons: this.polygons,
      mask: this.mask,
      metrics: {
        boundsWidth: this.metrics.bounds?.width ?? 0,
        boundsHeight: this.metrics.bounds?.height ?? 0,
        shadowArea: this.metrics.shadowArea,
        voidRatio: this.metrics.voidRatio,
      },
      name: this.doc.name || '未命名作品',
      author: this.author,
      patternLabel: this.doc.isUserCreation ? '用户创作（自绘棂条）' : patternDisplayName(this.doc.patternId),
      parameterLines,
      modelNote: card?.modelNote ?? '本作品是数字创作示意。',
      colors: { wall: '#fdf9f1', ink: '#31455a' },
    };
  }

  onOpenLibrary(): void {
    this.openLibrary();
  }

  onStartExperiment(kind: ExperimentKind): void {
    const spec = EXPERIMENTS.find((e) => e.kind === kind);
    this.experiments.begin(kind, this.transform, this.deps.light.get(), this.metrics);
    this.setNotice(`实验已开始：${spec?.title ?? ''}。改变窗格或光源，右侧会实时给出真实读数。`);
    this.render();
    this.hud.revealExperiment();
  }

  onResetExperiment(): void {
    const restored = this.experiments.restore();
    if (!restored) {
      this.setNotice('当前没有进行中的实验。');
      return;
    }
    this.transform = restored.transform;
    this.deps.light.setObjectDepthLimit(restored.transform.z);
    this.deps.light.set(restored.light);
    const stage = this.stage;
    if (stage) {
      stage.setTransform(restored.transform);
      this.interaction.syncTransforms(stage.transformsForAllStrokes());
    }
    this.setNotice('已重置实验状态，关卡存档与已保存作品未受影响。');
    this.markDirty(true);
  }

  onToggleRays(v: boolean): void {
    this.raysOn = v;
    this.setRays(v);
    this.setNotice(v ? '已显示示意光线（光源到窗格采样点）。' : '已隐藏示意光线。');
    this.markDirty(true);
  }

  onToggleAssist(v: boolean): void {
    this.assistOn = v;
    if (v) this.rebuildAssistBox();
    else if (this.assistBox) {
      this.assistBox.visible = false;
    }
    this.setNotice(v ? '已显示窗格范围框。' : '已隐藏窗格范围框。');
    this.render();
  }

  // 视角
  onViewChange(part: Partial<ViewState>): void {
    this.deps.sceneManager.setView(part);
  }

  onViewPreset(name: ViewPreset): void {
    this.deps.sceneManager.setPreset(name);
  }

  onViewReset(): void {
    this.deps.sceneManager.resetView();
  }

  // ───────────────────────── 自绘 ─────────────────────────

  /** @returns 折线是否真的写进了文档（超出复杂度上限时返回 false） */
  private addUserStroke(points: Array<{ x: number; y: number }>): boolean {
    const draft = { ...this.doc, strokes: [...this.doc.strokes, makeUserStroke(0, points, this.doc.barWidth)] };
    const limit = exceedsUserLimits(draft);
    if (limit) {
      this.setNotice(limit);
      return false;
    }
    const index = this.doc.strokes.filter((s) => s.source === 'user').length + 1;
    const stroke = makeUserStroke(index, points, this.doc.barWidth);
    this.pushHistory();
    const next: WindowDocument = {
      ...this.doc,
      patternId: 'custom',
      isUserCreation: true,
      name: this.doc.isUserCreation ? this.doc.name : `${this.doc.name}（自绘）`,
      strokes: [...this.doc.strokes, stroke],
      updatedAt: new Date().toISOString(),
    };
    this.selectedStrokeId = stroke.id;
    this.applyDocChange(next);
    this.setNotice('已添加一条自绘棂条（标注为「用户创作」）。');
    return true;
  }

  private clientToLocal(clientX: number, clientY: number): { x: number; y: number } | null {
    const stage = this.stage;
    if (!stage) return null;
    const ndc = this.deps.sceneManager.toNDC(clientX, clientY);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.deps.sceneManager.camera);

    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(stage.root.getWorldQuaternion(new THREE.Quaternion()));
    const center = stage.root.getWorldPosition(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, center);
    const hit = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, hit)) return null;

    const local = stage.root.worldToLocal(hit);
    const halfW = this.doc.width / 2 - this.doc.frameWidth * 0.5;
    const halfH = this.doc.height / 2 - this.doc.frameWidth * 0.5;
    const snapped = snapPoint({ x: local.x, y: local.y }, this.drawing.gridStep);
    return clampLocalPoint(snapped, halfW, halfH);
  }

  private localToClient(local: { x: number; y: number }): { x: number; y: number } {
    const stage = this.stage;
    if (!stage) return { x: 0, y: 0 };
    const world = stage.root.localToWorld(new THREE.Vector3(local.x, local.y, 0));
    return this.deps.sceneManager.worldToScreen(world);
  }

  // ───────────────────────── 辅助显示 ─────────────────────────

  private setRays(on: boolean): void {
    this.raysGroup.clear();
    if (on) this.rebuildRays();
    this.raysGroup.visible = on;
  }

  private rebuildRays(): void {
    const stage = this.stage;
    this.raysGroup.clear();
    if (!stage) return;
    const rays = representativeRays(stage.root, this.deps.light.get(), 24);
    if (rays.length === 0) return;
    const pts: THREE.Vector3[] = [];
    for (const [a, b] of rays) pts.push(a, b);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: '#e8a33d', transparent: true, opacity: 0.5 });
    const lines = new THREE.LineSegments(geo, mat);
    lines.userData.disposable = true;
    this.raysGroup.add(lines);
    this.raysGroup.visible = true;
  }

  private rebuildAssistBox(): void {
    const stage = this.stage;
    if (!stage) return;
    if (this.assistBox) {
      stage.root.remove(this.assistBox);
      this.assistBox.geometry.dispose();
      this.assistBox = null;
    }
    const w = this.doc.width;
    const hh = this.doc.height;
    const d = this.doc.depth;
    const pts: THREE.Vector3[] = [];
    const corners: THREE.Vector3[] = [];
    for (const x of [-w / 2, w / 2]) {
      for (const y of [-hh / 2, hh / 2]) {
        for (const z of [-d / 2, d / 2]) corners.push(new THREE.Vector3(x, y, z));
      }
    }
    const edges: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 3],
      [4, 5],
      [4, 6],
      [5, 7],
      [6, 7],
      [0, 4],
      [1, 5],
      [2, 6],
      [3, 7],
    ];
    for (const [a, b] of edges) pts.push(corners[a], corners[b]);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: '#2f8fa8', transparent: true, opacity: 0.55 });
    this.assistBox = new THREE.LineSegments(geo, mat);
    this.assistBox.visible = true;
    this.assistBox.renderOrder = 5;
    stage.root.add(this.assistBox);
  }

  // ───────────────────────── 选中 / 状态 ─────────────────────────

  private onSelect(id: string | null): void {
    this.selectedStrokeId = id;
    this.render();
  }

  private setNotice(message: string): void {
    this.notice = message;
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => {
      this.noticeTimer = null;
      this.notice = '';
      this.render();
    }, 6000);
    this.render();
  }

  // ───────────────────────── 作品集 ─────────────────────────

  openLibrary(): void {
    this.modalsOpen++;
    const list = listArtworks();
    const items = list.length
      ? list.map((a) => {
          const row = document.createElement('div');
          row.className = 'artwork-item';
          const name = document.createElement('div');
          name.className = 'artwork-name';
          name.textContent = a.name;
          const meta = document.createElement('div');
          meta.className = 'artwork-meta tiny muted';
          meta.textContent = `${a.isUserCreation ? '用户创作' : a.patternId} · ${a.strokeCount} 笔 · ${new Date(a.updatedAt).toLocaleString('zh-CN', { hour12: false })}`;
          const actions = document.createElement('div');
          actions.className = 'artwork-actions';

          const openBtn = document.createElement('button');
          openBtn.className = 'btn btn-sm';
          openBtn.textContent = '打开';
          openBtn.onclick = () => {
            const rec = getArtwork(a.id);
            if (!rec) {
              this.setNotice('这条作品数据已损坏，无法打开。');
              return;
            }
            this.deps.closeModal();
            this.loadArtwork(rec);
          };

          const delBtn = document.createElement('button');
          delBtn.className = 'btn btn-sm btn-danger';
          delBtn.textContent = '删除';
          delBtn.onclick = () => {
            if (!window.confirm(`确定删除作品《${a.name}》？此操作不可撤销。`)) return;
            if (deleteArtwork(a.id)) {
              this.deps.closeModal();
              this.setNotice(`已删除作品《${a.name}》。`);
            } else {
              this.setNotice('删除失败，请稍后重试。');
            }
          };

          actions.append(openBtn, delBtn);
          row.append(name, meta, actions);
          return row;
        })
      : [(() => {
          const empty = document.createElement('div');
          empty.className = 'side-empty';
          empty.textContent = '还没有保存过作品。回到工坊点「保存作品」即可。';
          return empty;
        })()];

    const box = document.createElement('div');
    box.className = 'modal artwork-modal';
    const h2 = document.createElement('h2');
    h2.textContent = '我的作品集';
    const tip = document.createElement('p');
    tip.className = 'tiny muted';
    tip.textContent = '作品保存在本机浏览器里（localStorage），与关卡存档互不影响。删除前会二次确认。';
    const listWrap = document.createElement('div');
    listWrap.className = 'artwork-list';
    listWrap.append(...items);
    const footer = document.createElement('div');
    footer.className = 'modal-actions';
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = '关闭';
    close.onclick = () => this.deps.closeModal();
    footer.append(close);
    box.append(h2, tip, listWrap, footer);

    const mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.append(box);
    this.deps.openModal(mask);
  }

  loadArtwork(rec: ReturnType<typeof getArtwork>): void {
    if (!rec) return;
    this.dropStalePolyline();
    this.doc = rec.doc;
    this.author = rec.author;
    this.savedArtworkId = rec.id;
    this.savedLabel = '已载入作品';
    this.selectedStrokeId = null;
    void this.ensureStage().then(() => {
      this.transform = rec.transform;
      this.deps.light.setObjectDepthLimit(rec.transform.z);
      this.deps.light.set(rec.light);
      this.rebuildStage();
      this.markDirty(true);
    });
    this.setNotice(`已打开作品《${rec.name}》。`);
  }

  onModalClosed(): void {
    this.modalsOpen = Math.max(0, this.modalsOpen - 1);
  }

  /** 供 SceneManager 判断"这一点是否落在可拖动对象上" */
  hitTest(clientX: number, clientY: number): boolean {
    if (!this.entered || this.drawing.isEnabled) return false;
    return this.interaction.hitTestAt(clientX, clientY);
  }

  setInteractionEnabled(v: boolean): void {
    this.interaction.setEnabled(v && !this.drawing.isEnabled);
  }

  // ───────────────────────── 测试与诊断 ─────────────────────────

  /** 供自动化测试读取的工坊状态快照（只读） */
  debugState() {
    return {
      patternId: this.doc.patternId,
      name: this.doc.name,
      strokes: this.doc.strokes.length,
      userStrokes: this.doc.strokes.filter((s) => s.source === 'user').length,
      segments: strokeStats(this.doc).segments,
      polygonCount: this.polygons.length,
      maskPixels: this.metrics.maskPixels,
      bounds: this.metrics.bounds,
      voidRatio: this.metrics.voidRatio,
      shadowArea: this.metrics.shadowArea,
      drawing: this.drawing.isEnabled,
      selectedStrokeId: this.selectedStrokeId,
      highlighted: this.stage?.highlightedBarCount() ?? 0,
      transform: { ...this.transform },
      light: this.deps.light.get(),
      rays: this.raysOn,
      experiment: this.experiments.kind,
      note: this.note,
      savedLabel: this.savedLabel,
      canUndo: this.history.length > 0,
      canRedo: this.future.length > 0,
    };
  }

  /** 测试专用：直接替换文档（不写历史） */
  debugSetDocument(doc: WindowDocument): void {
    this.applyDocChange(doc);
  }

  /** 测试专用：设置窗格深度 */
  debugSetDepth(z: number): void {
    this.setTransform({ ...this.transform, z }, true);
  }

  /** 测试专用：切换模板 */
  debugPickPattern(id: PatternKind): void {
    this.onPickPattern(id);
  }

  /** 测试专用：渲染海报到离屏画布（用于校验导出内容与投影一致） */
  debugRenderPoster(): { dataUrl: string; width: number; height: number } {
    const canvas = renderPoster(this.posterInput());
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  }

  /** 测试专用：修改模板参数 */
  debugSetParams(patch: Partial<PatternParameters>): void {
    this.onParamChange(patch);
  }

  /** 测试专用：保存作品并返回作品集列表 */
  debugSave(name?: string): ReturnType<typeof listArtworks> {
    if (name) this.doc = { ...this.doc, name };
    this.save(null);
    return listArtworks();
  }

  /** 测试专用：打开作品 */
  debugLoad(id: string): boolean {
    const rec = getArtwork(id);
    if (!rec) return false;
    this.loadArtwork(rec);
    return true;
  }

  /**
   * 测试专用：走完整的导出代码路径（合成海报 + toBlob），但不触发下载，
   * 这样自动化测试能验证"导出的海报确实生成了 PNG 数据"。
   */
  async debugExport(): Promise<{ ok: boolean; size: number; message?: string }> {
    try {
      const canvas = renderPoster(this.posterInput());
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) return { ok: false, size: 0, message: 'toBlob 返回 null' };
      return { ok: true, size: blob.size };
    } catch (e) {
      return { ok: false, size: 0, message: e instanceof Error ? e.message : String(e) };
    }
  }

  /** 测试专用：模拟一次自绘（等价于点选若干节点并结束线条） */
  debugDrawPolyline(localPoints: Array<{ x: number; y: number }>): boolean {
    this.addUserStroke(localPoints);
    return true;
  }

  /** 测试专用：读取投影多边形（墙面坐标），用于验证显示与判定同源 */
  debugPolygons(): Point2[][] {
    // 解析式重算并与渲染路径比对，确保两条路径一致
    const stage = this.stage;
    if (!stage) return [];
    return projectWindowBars(extractBars(this.doc), stage.worldMatrix(), this.deps.light.get()).polygons;
  }

  dispose(): void {
    this.drawing.dispose();
    this.interaction.dispose();
    this.raysGroup.clear();
    if (this.noticeTimer !== null) window.clearTimeout(this.noticeTimer);
    this.stage?.dispose();
    this.stage?.root.removeFromParent();
  }
}
