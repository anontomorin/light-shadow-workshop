import { h, sliderRow } from './dom';
import { createViewPanel, type ViewPanelHandlers } from './viewPanel';
import { getCultureCard, getSources } from '../culture/patternCatalog';
import { PATTERN_DEFINITIONS } from '../patterns/PatternRegistry';
import { PARAM_LIMITS, WINDOW_LIMITS } from '../window-builder/GeometryLimits';
import type { PatternKind, PatternParameters, Vec2Data, WindowDocument } from '../patterns/types';
import type { Transform3D } from '../gameplay/LevelData';
import type { StrokeStats } from '../window-builder/WindowDocument';
import type { ProjectionMetrics } from '../projection/ProjectionDiagnostics';
import type { ViewState } from '../scene/SceneManager';
import { EXPERIMENTS, type ExperimentKind } from '../workshop/GuidedExperiments';

/**
 * 花窗工坊界面。
 *
 * 布局（桌面优先）：**中间是三维操作区，且占据尽可能大的宽度**（两侧栏可一键收起），
 * 左栏 = 纹样模板 / 构件统计 / 自绘入口，右栏 = 参数 / 摆放 / 真实读数 / 文化卡片。
 * 三维操作区上再叠一层浮层：左上「操作指引」卡、右上侧栏开关、底部状态条。
 * 窄屏时改为上下堆叠，画布永远排在最前且保持可用的最小高度。
 *
 * 本类只负责"把状态画成界面 + 把用户操作转发出去"，不含任何几何或投影计算。
 */

export interface WorkshopHandlers extends ViewPanelHandlers {
  onBack: () => void;
  onPickPattern: (id: PatternKind) => void;
  onParamChange: (patch: Partial<PatternParameters>) => void;
  onTransformChange: (patch: Partial<Transform3D>) => void;
  onLightChange: (axis: 'x' | 'y' | 'z', v: number) => void;
  onRestoreTemplate: () => void;
  onClearDraft: () => void;
  onDeleteStroke: () => void;
  onUndoStroke: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToggleDraw: () => void;
  onFinishLine: () => void;
  onUndoLastNode: () => void;
  onToggleSnap: (v: boolean) => void;
  onNameChange: (v: string) => void;
  onAuthorChange: (v: string) => void;
  onSave: () => void;
  onSaveAs: () => void;
  onExport: () => void;
  onOpenLibrary: () => void;
  onStartExperiment: (kind: ExperimentKind) => void;
  onResetExperiment: () => void;
  onToggleRays: (v: boolean) => void;
  onToggleAssist: (v: boolean) => void;
}

export interface WorkshopView {
  doc: WindowDocument;
  stats: StrokeStats;
  transform: Transform3D;
  light: { x: number; y: number; z: number };
  lightLimits: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  metrics: ProjectionMetrics;
  note: string;
  notice: string;
  drawing: boolean;
  drawSegments: number;
  /** 当前折线已落下的节点数（绘制模式下用于状态条提示） */
  drawNodes: number;
  snap: boolean;
  selectedStrokeId: string | null;
  author: string;
  savedLabel: string;
  raysOn: boolean;
  assistOn: boolean;
  canUndo: boolean;
  canRedo: boolean;
  experiment: {
    running: boolean;
    kind: ExperimentKind | null;
    title: string;
    narrative: string;
    steps: string[];
    conclusion: string;
  };
}

export class WindowEditorHUD {
  readonly root: HTMLElement;
  readonly stageEl: HTMLElement;
  readonly drawOverlay: SVGSVGElement;

  private handlers: WorkshopHandlers;
  private patternButtons = new Map<PatternKind, HTMLElement>();
  private nameInput: HTMLInputElement;
  private authorInput: HTMLInputElement;
  private savedLabelEl: HTMLElement;
  private statsEl: HTMLElement;
  private metricsEls = new Map<string, HTMLElement>();
  private cultureEl: HTMLElement;
  private noticeEl: HTMLElement;
  private drawHintEl: HTMLElement;
  private experimentEl: HTMLElement;
  private experimentStepsEl!: HTMLOListElement;
  private experimentNarrativeEl!: HTMLElement;
  private experimentListEl!: HTMLElement;
  private snapToggle: HTMLInputElement;
  private raysToggle: HTMLInputElement;
  private assistToggle: HTMLInputElement;
  private drawButton: HTMLButtonElement;
  private finishButton: HTMLButtonElement;
  private undoNodeButton: HTMLButtonElement;
  private deleteButton: HTMLButtonElement;
  private undoButton: HTMLButtonElement;
  private redoButton: HTMLButtonElement;
  private resetExperimentButton: HTMLButtonElement;
  private viewPanel: ReturnType<typeof createViewPanel>;
  private borderToggle: HTMLInputElement | null = null;

  // 绘制浮层（全部是 SVG 图元，屏幕坐标 = 浮层坐标系）
  private drawFrame: SVGRectElement;
  private drawGhostLine: SVGPolylineElement;
  private drawPreviewLine: SVGPolylineElement;
  private drawRubberLine: SVGLineElement;
  private drawHoverDot: SVGCircleElement;
  private drawHoverLabel: SVGTextElement;
  private drawNodeLayer: SVGGElement;
  private drawPoints: Vec2Data[] = [];
  private drawHover: Vec2Data | null = null;
  private drawHoverLocal: Vec2Data | null = null;
  private drawBarPx = 0;

  // 画布浮层：操作指引卡 / 侧栏开关 / 底部状态条
  // （在 buildStageHud() 里创建，由构造函数调用，故用确定赋值断言）
  private bodyEl: HTMLElement;
  private guideEl!: HTMLElement;
  private guideBodyEl!: HTMLElement;
  private guideToggleBtn!: HTMLButtonElement;
  private stageStatusEl!: HTMLElement;
  private collapseButtons = new Map<'left' | 'right', HTMLButtonElement>();
  private collapsed = { left: false, right: false };
  private guideOpen = true;

  private sliders: Record<string, ReturnType<typeof sliderRow>> = {};
  private transformSliders: Record<string, ReturnType<typeof sliderRow>> = {};

  constructor(handlers: WorkshopHandlers) {
    this.handlers = handlers;

    // ── 顶部栏 ──
    this.nameInput = h('input', {
      class: 'text-input',
      type: 'text',
      maxlength: '40',
      placeholder: '作品名称',
      oninput: (e: Event) => handlers.onNameChange((e.target as HTMLInputElement).value),
    }) as HTMLInputElement;

    this.authorInput = h('input', {
      class: 'text-input text-input-sm',
      type: 'text',
      maxlength: '24',
      placeholder: '作者（可选）',
      oninput: (e: Event) => handlers.onAuthorChange((e.target as HTMLInputElement).value),
    }) as HTMLInputElement;

    this.savedLabelEl = h('span', { class: 'save-state', text: '未保存' });

    const topbar = h('div', { class: 'game-topbar' }, [
      h('button', {
        class: 'btn btn-icon',
        text: '←',
        'aria-label': '返回首页',
        title: '返回首页',
        onclick: () => handlers.onBack(),
      }),
      h('div', { class: 'topbar-info' }, [
        h('div', { class: 'lv', text: '花窗工坊' }),
        h('div', { class: 'name', text: '传统建筑纹样的数字化探索' }),
      ]),
      h('div', { class: 'topbar-spacer' }),
      this.nameInput,
      this.authorInput,
      this.savedLabelEl,
      h('button', { class: 'btn btn-sm', text: '作品集', onclick: () => handlers.onOpenLibrary() }),
    ]);

    // ── 主舞台 ──
    this.stageEl = h('div', { class: 'stage' });
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] => {
      const el = document.createElementNS(SVG_NS, tag);
      el.setAttribute('class', cls);
      return el;
    };
    this.drawOverlay = document.createElementNS(SVG_NS, 'svg');
    this.drawOverlay.setAttribute('class', 'draw-overlay');
    this.drawOverlay.setAttribute('aria-hidden', 'true');
    // 层序（自下而上）：范围虚线 → 真实粗细的棂条预览 → 中心折线 → 橡皮筋 → 光标点 → 节点
    this.drawFrame = svgEl('rect', 'draw-frame');
    this.drawGhostLine = svgEl('polyline', 'draw-ghost');
    this.drawPreviewLine = svgEl('polyline', 'draw-preview');
    this.drawRubberLine = svgEl('line', 'draw-rubber');
    this.drawHoverDot = svgEl('circle', 'draw-hover-dot');
    this.drawHoverLabel = svgEl('text', 'draw-hover-label');
    this.drawNodeLayer = svgEl('g', 'draw-node-layer');
    this.drawOverlay.append(
      this.drawFrame,
      this.drawGhostLine,
      this.drawPreviewLine,
      this.drawRubberLine,
      this.drawHoverDot,
      this.drawHoverLabel,
      this.drawNodeLayer,
    );

    this.noticeEl = h('div', { class: 'notice-bar hidden' });

    const stageWrap = h('div', { class: 'stage-wrap' }, [
      this.stageEl,
      this.drawOverlay,
      this.buildStageHud(),
      this.noticeEl,
    ]);

    // ── 左栏：模板与构件 ──
    const patternList = h('div', { class: 'pattern-list' });
    for (const def of PATTERN_DEFINITIONS) {
      const btn = h('button', {
        class: 'pattern-card',
        'data-pattern': def.id,
        onclick: () => handlers.onPickPattern(def.id),
      }) as HTMLElement;
      btn.append(
        h('span', { class: 'pattern-name', text: def.displayName }),
        h('span', { class: 'pattern-desc', text: def.shortDescription.slice(0, 34) + '…' }),
      );
      this.patternButtons.set(def.id, btn);
      patternList.append(btn);
    }

    this.statsEl = h('div', { class: 'component-stats' });

    this.drawHintEl = h('div', { class: 'draw-hint' });

    this.snapToggle = h('input', {
      type: 'checkbox',
      onchange: (e: Event) => handlers.onToggleSnap((e.target as HTMLInputElement).checked),
    }) as HTMLInputElement;

    const leftPanel = h('aside', { class: 'workshop-panel workshop-left' }, [
      h('div', { class: 'side-section' }, [h('h3', { text: '纹样模板' }), patternList]),
      h('div', { class: 'side-section' }, [h('h3', { text: '构件统计' }), this.statsEl]),
      h('div', { class: 'side-section' }, [
        h('h3', { text: '自绘棂条（用户创作）' }),
        h('label', { class: 'check-row' }, [this.snapToggle, h('span', { text: '吸附网格（0.1 单位）' })]),
        this.drawHintEl,
      ]),
    ]);

    // ── 右栏：参数 / 读数 / 文化 ──
    this.buildParamSliders();
    this.buildTransformSliders();
    const paramPanel = h('div', { class: 'side-section' }, [
      h('h3', { text: '窗格参数' }),
      ...Object.values(this.sliders).map((s) => s.row),
      h('div', { class: 'border-toggle' }, [
        h('label', { class: 'check-row' }, [
          this.makeBorderToggle(),
          h('span', { text: '叠加回纹边饰（辅助装饰）' }),
        ]),
      ]),
      h('div', { class: 'rotate-group' }, [
        h('button', { class: 'btn btn-sm', text: '恢复当前模板', onclick: () => handlers.onRestoreTemplate() }),
        h('button', { class: 'btn btn-sm', text: '清空草稿', onclick: () => handlers.onClearDraft() }),
      ]),
      h('div', { class: 'tiny muted', text: '清空草稿只保留窗框，模板其余部分可随时用「恢复当前模板」重建。' }),
    ]);

    const transformPanel = h('div', { class: 'side-section' }, [
      h('h3', { text: '窗格摆放' }),
      ...Object.values(this.transformSliders).map((s) => s.row),
      h('div', { class: 'tiny muted', text: '也可以直接在画布里拖动窗格，或用 Q / E 键旋转选中构件。' }),
    ]);

    const metricsPanel = h('div', { class: 'side-section' }, [
      h('h3', { text: '真实投影读数' }),
      h('div', { class: 'metrics-panel' }, [
        this.metricRow('width', '投影宽度'),
        this.metricRow('height', '投影高度'),
        this.metricRow('area', '影子面积'),
        this.metricRow('void', '镂空率'),
        this.metricRow('boundsArea', '包围盒面积'),
      ]),
      h('div', { class: 'tiny muted', text: '读数由当前投影多边形与二值掩码实时计算，不使用任何预设值。' }),
    ]);

    const lightPanel = h('div', { class: 'side-section' }, [
      h('h3', { text: '点光源' }),
      this.buildLightSliders(),
    ]);

    this.cultureEl = h('div', { class: 'side-section culture-card' });
    this.experimentEl = h('div', { class: 'side-section experiment-card' });
    this.buildExperimentPanel();

    const assistRow = h('div', { class: 'assist-row' });
    this.raysToggle = h('input', {
      type: 'checkbox',
      onchange: (e: Event) => handlers.onToggleRays((e.target as HTMLInputElement).checked),
    }) as HTMLInputElement;
    this.assistToggle = h('input', {
      type: 'checkbox',
      onchange: (e: Event) => handlers.onToggleAssist((e.target as HTMLInputElement).checked),
    }) as HTMLInputElement;
    assistRow.append(
      h('label', { class: 'check-row' }, [this.raysToggle, h('span', { text: '显示示意光线' })]),
      h('label', { class: 'check-row' }, [this.assistToggle, h('span', { text: '显示窗格范围框' })]),
    );

    this.viewPanel = createViewPanel(handlers);

    const rightPanel = h('aside', { class: 'workshop-panel workshop-right' }, [
      paramPanel,
      transformPanel,
      metricsPanel,
      lightPanel,
      h('div', { class: 'side-section' }, [h('h3', { text: '投影辅助' }), assistRow, h('div', { class: 'tiny muted', text: '「示意光线」是从光源到窗格采样点的少量线段，仅用于理解光路；测量全部来自真实投影计算。' })]),
      this.cultureEl,
      this.experimentEl,
      h('div', { class: 'side-section' }, [h('h3', { text: '观看视角' }), this.viewPanel.root]),
    ]);

    // ── 底部操作坞 ──
    this.drawButton = h('button', {
      class: 'btn btn-sm',
      text: '画棂条',
      onclick: () => handlers.onToggleDraw(),
    }) as HTMLButtonElement;
    this.finishButton = h('button', {
      class: 'btn btn-sm',
      text: '完成线条',
      onclick: () => handlers.onFinishLine(),
    }) as HTMLButtonElement;
    this.undoNodeButton = h('button', {
      class: 'btn btn-sm',
      text: '撤销节点',
      onclick: () => handlers.onUndoLastNode(),
    }) as HTMLButtonElement;
    this.deleteButton = h('button', {
      class: 'btn btn-sm',
      text: '删除选中笔画',
      onclick: () => handlers.onDeleteStroke(),
    }) as HTMLButtonElement;
    this.undoButton = h('button', {
      class: 'btn btn-sm',
      text: '撤销',
      onclick: () => handlers.onUndo(),
    }) as HTMLButtonElement;
    this.redoButton = h('button', {
      class: 'btn btn-sm',
      text: '重做',
      onclick: () => handlers.onRedo(),
    }) as HTMLButtonElement;
    this.resetExperimentButton = h('button', {
      class: 'btn btn-sm',
      text: '重置实验',
      onclick: () => handlers.onResetExperiment(),
    }) as HTMLButtonElement;

    const dock = h('div', { class: 'game-dock workshop-dock' }, [
      h('div', { class: 'dock-group' }, [
        this.drawButton,
        this.finishButton,
        this.undoNodeButton,
        h('button', {
          class: 'btn btn-sm',
          text: '撤销上一条笔画',
          onclick: () => handlers.onUndoStroke(),
        }),
        this.deleteButton,
        this.undoButton,
        this.redoButton,
      ]),
      h('div', { class: 'dock-actions' }, [
        this.resetExperimentButton,
        h('button', { class: 'btn btn-sm', text: '保存作品', onclick: () => handlers.onSave() }),
        h('button', { class: 'btn btn-sm', text: '另存为', onclick: () => handlers.onSaveAs() }),
        h('button', { class: 'btn btn-primary btn-sm', text: '导出 PNG 海报', onclick: () => handlers.onExport() }),
      ]),
    ]);

    this.bodyEl = h('div', { class: 'workshop-body' }, [leftPanel, stageWrap, rightPanel]);

    this.root = h('section', { class: 'screen workshop-screen' }, [topbar, this.bodyEl, dock]);

    // 画布优先：默认三栏全开，收起状态与指引卡开合都沿用上次的选择
    this.applyCollapse();
    this.restoreGuideState();
  }

  // ───────────────────────── 构造片段 ─────────────────────────

  /**
   * 画布浮层。三块内容都贴在三维操作区上：
   *   · 左上「操作指引」卡（可收起，收起状态记在 localStorage）
   *   · 右上「左栏 / 右栏」开关，两侧栏收起后画布铺满整行
   *   · 底部状态条（位置 / 深度 / 影子尺寸 / 镂空率），折叠右栏后仍能读到关键读数
   *
   * 所有提示文字都对应代码里真实存在的交互：拖动 / Q E / 方向键来自
   * InteractionController，环绕与缩放来自 SceneManager.setupViewControls，
   * 绘制流程来自 DrawingTool。没有为了排版好看而虚构的快捷键。
   */
  private buildStageHud(): HTMLElement {
    const tools = h('div', { class: 'stage-tools' });
    for (const side of ['left', 'right'] as const) {
      const btn = h('button', {
        class: 'btn btn-sm side-toggle',
        text: side === 'left' ? '模板栏' : '参数栏',
        title: side === 'left' ? '展开 / 收起左侧纹样与构件栏' : '展开 / 收起右侧参数与读数栏',
        'aria-pressed': 'true',
        onclick: () => this.toggleSide(side),
      }) as HTMLButtonElement;
      this.collapseButtons.set(side, btn);
      tools.append(btn);
    }

    this.stageStatusEl = h('div', { class: 'stage-status', text: '' });

    return h('div', { class: 'stage-hud' }, [this.buildGuideCard(), tools, this.stageStatusEl]);
  }

  private buildGuideCard(): HTMLElement {
    this.guideToggleBtn = h('button', {
      class: 'btn btn-sm guide-toggle',
      text: '收起',
      onclick: () => this.setGuideOpen(!this.guideOpen),
    }) as HTMLButtonElement;

    const step = (n: number, title: string, body: string) =>
      h('li', { class: 'guide-step' }, [
        h('span', { class: 'guide-step-no', text: String(n) }),
        h('span', { class: 'guide-step-text' }, [
          h('b', { text: title }),
          h('span', { text: `　${body}` }),
        ]),
      ]);

    const row = (keys: string[], desc: string) =>
      h('div', { class: 'guide-row' }, [
        h('span', { class: 'guide-keys' }, keys.map((k) => h('span', { class: 'kbd', text: k }))),
        h('span', { class: 'guide-desc', text: desc }),
      ]);

    const group = (title: string, rows: HTMLElement[]) =>
      h('div', { class: 'guide-group' }, [h('div', { class: 'guide-group-title', text: title }), ...rows]);

    const body = h('div', { class: 'guide-body' }, [
      h('div', { class: 'guide-block-title', text: '四步上手' }),
      h('ol', { class: 'guide-steps' }, [
        step(1, '选纹样', '左栏「纹样模板」点一张卡片，画布和墙上的影子会立刻重算。'),
        step(2, '摆窗格', '在画布上按住窗格直接拖动；Q / E 旋转；方向键做最后一点微调。'),
        step(3, '调影子', '右栏「窗格摆放」拖「窗格深度 Z」——窗格越靠近光源，影子越大。'),
        step(4, '带走它', '底部「保存作品」存进作品集，或「导出 PNG 海报」拿一张 1920×1080 的图。'),
      ]),
      h('div', { class: 'guide-block-title', text: '操作一览' }),
      group('走位与旋转（先点一下窗格选中它；右栏「窗格摆放」滑杆可直接输入精确数值）', [
        row(['左键拖窗格'], '在投影墙前的平面内移动'),
        row(['Q', 'E'], '面内旋转 5°'),
        row(['Shift', 'Q/E'], '旋转 15°'),
        row(['方向键'], '微调位置 0.04 单位'),
        row(['Shift', '方向键'], '粗调位置 0.18 单位'),
      ]),
      group('看视角（拖空白处，不会动到窗格；右栏有正视 / 侧视 / 俯视与复位）', [
        row(['左键拖空白'], '环绕视角'),
        row(['右键拖'], '环绕视角'),
        row(['Shift', '右键'], '平移视角（也可用中键拖动）'),
        row(['滚轮'], '拉近 / 推远'),
      ]),
      group('画自己的棂条（底部「画棂条」进入绘制模式，再点一次「结束绘制」退出）', [
        row(['单击'], '在窗格上添加一个节点（当前节点有光晕与十字标识）'),
        row(['双击', 'Enter'], '完成当前折线，留着绘制模式继续画下一条'),
        row(['Esc'], '取消当前折线；折线为空时退出绘制模式'),
        row(['吸附网格'], '勾选后节点对齐 0.1 单位'),
      ]),
      group('存档与导出（都在底部操作坞）', [
        row(['保存作品', '另存为'], '存进作品集，与关卡进度分开保存'),
        row(['导出 PNG 海报'], '1920×1080，右侧窗影与墙上同源同数据'),
      ]),
    ]);

    this.guideBodyEl = body;
    this.guideEl = h('section', { class: 'guide-card' }, [
      h('header', { class: 'guide-head' }, [
        h('h4', { class: 'guide-title', text: '操作指引' }),
        h('span', {
          class: 'guide-draw-chip',
          text: '绘制中：单击加节点 · 双击 / Enter 完成 · Esc 取消或退出',
        }),
        this.guideToggleBtn,
      ]),
      body,
    ]);
    return this.guideEl;
  }

  private toggleSide(side: 'left' | 'right'): void {
    this.collapsed[side] = !this.collapsed[side];
    this.applyCollapse();
  }

  private applyCollapse(): void {
    const parts: string[] = [];
    if (this.collapsed.left) parts.push('left');
    if (this.collapsed.right) parts.push('right');
    const flags = parts.join(' ');
    if (flags) this.bodyEl.setAttribute('data-collapsed', flags);
    else this.bodyEl.removeAttribute('data-collapsed');

    for (const [side, btn] of this.collapseButtons) {
      const open = !this.collapsed[side];
      btn.classList.toggle('btn-active', !open);
      btn.setAttribute('aria-pressed', String(open));
      btn.title = `${open ? '收起' : '展开'}${side === 'left' ? '左侧纹样与构件栏' : '右侧参数与读数栏'}`;
    }
    this.bodyEl.classList.toggle('is-focused', this.collapsed.left && this.collapsed.right);
  }

  private setGuideOpen(open: boolean): void {
    this.guideOpen = open;
    this.guideEl.classList.toggle('collapsed', !open);
    this.guideToggleBtn.textContent = open ? '收起' : '展开';
    try {
      window.localStorage.setItem(GUIDE_STORAGE_KEY, open ? 'open' : 'closed');
    } catch {
      /* 隐私模式下 localStorage 可能不可写，忽略 */
    }
  }

  /** 记住上一次的收起状态（读不到就保持展开） */
  private restoreGuideState(): void {
    let open = true;
    try {
      open = window.localStorage.getItem(GUIDE_STORAGE_KEY) !== 'closed';
    } catch {
      /* ignore */
    }
    this.setGuideOpen(open);
  }

  private metricRow(key: string, label: string): HTMLElement {
    const value = h('span', { class: 'v mono', text: '—' });
    this.metricsEls.set(key, value);
    return h('div', { class: 'metric-row' }, [h('span', { class: 'k', text: label }), value]);
  }

  private makeBorderToggle(): HTMLInputElement {
    this.borderToggle = h('input', {
      type: 'checkbox',
      onchange: (e: Event) =>
        this.handlers.onParamChange({ borderEnabled: (e.target as HTMLInputElement).checked }),
    }) as HTMLInputElement;
    return this.borderToggle;
  }

  /** 只在滑杆未被拖动时才回写数值，避免打断拖拽手感 */
  private setSlider(s: ReturnType<typeof sliderRow> | undefined, value: number): void {
    if (!s) return;
    if (document.activeElement === s.input) return;
    s.set(value);
  }

  private buildParamSliders(): void {
    this.sliders.width = sliderRow({
      label: '窗格宽度',
      min: WINDOW_LIMITS.minWidth,
      max: WINDOW_LIMITS.maxWidth,
      step: 0.05,
      value: 3.2,
      onInput: (v) => this.handlers.onParamChange({ width: v }),
    });
    this.sliders.height = sliderRow({
      label: '窗格高度',
      min: WINDOW_LIMITS.minHeight,
      max: WINDOW_LIMITS.maxHeight,
      step: 0.05,
      value: 4.6,
      onInput: (v) => this.handlers.onParamChange({ height: v }),
    });
    this.sliders.frameWidth = sliderRow({
      label: '外框宽度',
      min: WINDOW_LIMITS.minFrameWidth,
      max: WINDOW_LIMITS.maxFrameWidth,
      step: 0.01,
      value: 0.2,
      format: (v) => v.toFixed(2),
      onInput: (v) => this.handlers.onParamChange({ frameWidth: v }),
    });
    this.sliders.barWidth = sliderRow({
      label: '棂条宽度',
      min: WINDOW_LIMITS.minBarWidth,
      max: WINDOW_LIMITS.maxBarWidth,
      step: 0.01,
      value: 0.09,
      format: (v) => v.toFixed(2),
      onInput: (v) => this.handlers.onParamChange({ barWidth: v }),
    });
    this.sliders.rowCount = sliderRow({
      label: '行数',
      min: PARAM_LIMITS.minRowCount,
      max: PARAM_LIMITS.maxRowCount,
      step: 1,
      value: 4,
      format: (v) => v.toFixed(0),
      onInput: (v) => this.handlers.onParamChange({ rowCount: v }),
    });
    this.sliders.columnCount = sliderRow({
      label: '列数',
      min: PARAM_LIMITS.minColumnCount,
      max: PARAM_LIMITS.maxColumnCount,
      step: 1,
      value: 4,
      format: (v) => v.toFixed(0),
      onInput: (v) => this.handlers.onParamChange({ columnCount: v }),
    });
    this.sliders.density = sliderRow({
      label: '冰裂纹密度',
      min: PARAM_LIMITS.minDensity,
      max: PARAM_LIMITS.maxDensity,
      step: 0.01,
      value: 0.85,
      format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => this.handlers.onParamChange({ density: v }),
    });
    this.sliders.seed = sliderRow({
      label: '随机种子',
      min: 1,
      max: 99999999,
      step: 1,
      value: 20261015,
      format: (v) => v.toFixed(0),
      onInput: (v) => this.handlers.onParamChange({ seed: Math.round(v) }),
    });
    this.sliders.borderRepeat = sliderRow({
      label: '边饰重复数',
      min: PARAM_LIMITS.minBorderRepeat,
      max: PARAM_LIMITS.maxBorderRepeat,
      step: 1,
      value: PARAM_LIMITS.defaultBorderRepeat,
      format: (v) => v.toFixed(0),
      onInput: (v) => this.handlers.onParamChange({ borderRepeat: v }),
    });
  }

  private buildTransformSliders(): void {
    this.transformSliders.depth = sliderRow({
      label: '窗格深度 Z',
      min: 1.2,
      max: 9.5,
      step: 0.05,
      value: 3.6,
      onInput: (v) => this.handlers.onTransformChange({ z: v }),
    });
    this.transformSliders.x = sliderRow({
      label: '左右位置 X',
      min: -7,
      max: 7,
      step: 0.05,
      value: 0,
      onInput: (v) => this.handlers.onTransformChange({ x: v }),
    });
    this.transformSliders.y = sliderRow({
      label: '上下位置 Y',
      min: 1.2,
      max: 9.2,
      step: 0.05,
      value: 5.2,
      onInput: (v) => this.handlers.onTransformChange({ y: v }),
    });
    this.transformSliders.rotationY = sliderRow({
      label: '翻转角 Y',
      min: -80,
      max: 80,
      step: 1,
      value: 0,
      format: (v) => `${v.toFixed(0)}°`,
      onInput: (v) => this.handlers.onTransformChange({ rotationY: v }),
    });
    this.transformSliders.rotationZ = sliderRow({
      label: '面内旋转 Z',
      min: -180,
      max: 180,
      step: 1,
      value: 0,
      format: (v) => `${v.toFixed(0)}°`,
      onInput: (v) => this.handlers.onTransformChange({ rotationZ: v }),
    });
  }

  private buildLightSliders(): HTMLElement {
    const x = sliderRow({
      label: '光源左右',
      min: -6,
      max: 6,
      step: 0.1,
      value: 0,
      onInput: (v) => this.handlers.onLightChange('x', v),
    });
    const y = sliderRow({
      label: '光源高低',
      min: 2.5,
      max: 9.5,
      step: 0.1,
      value: 5.5,
      onInput: (v) => this.handlers.onLightChange('y', v),
    });
    const z = sliderRow({
      label: '光源距离',
      min: 10,
      max: 20,
      step: 0.1,
      value: 14,
      onInput: (v) => this.handlers.onLightChange('z', v),
    });
    this.sliders.lightX = x;
    this.sliders.lightY = y;
    this.sliders.lightZ = z;
    return h('div', {}, [x.row, y.row, z.row]);
  }

  private buildExperimentPanel(): void {
    this.experimentListEl = h('div', { class: 'experiment-list' });
    for (const spec of EXPERIMENTS) {
      this.experimentListEl.append(
        h('button', {
          class: 'btn btn-sm',
          text: spec.title,
          onclick: () => this.handlers.onStartExperiment(spec.kind),
        }),
      );
    }
    this.experimentStepsEl = h('ol', { class: 'experiment-steps' });
    this.experimentNarrativeEl = h('div', { class: 'experiment-narrative' });
    this.experimentEl.append(
      h('h3', { text: '引导实验' }),
      h('div', { class: 'tiny muted', text: '实验只读取真实投影读数，不会改写关卡存档与已保存作品。' }),
      this.experimentListEl,
      this.experimentStepsEl,
      this.experimentNarrativeEl,
    );
  }

  // ───────────────────────── 渲染 ─────────────────────────

  render(v: WorkshopView): void {
    const doc = v.doc;

    if (document.activeElement !== this.nameInput) this.nameInput.value = doc.name;
    if (document.activeElement !== this.authorInput) this.authorInput.value = v.author;
    this.savedLabelEl.textContent = v.savedLabel;

    for (const [id, btn] of this.patternButtons) {
      btn.classList.toggle('active', !doc.isUserCreation && doc.patternId === id);
      btn.setAttribute('aria-pressed', String(!doc.isUserCreation && doc.patternId === id));
    }

    // 构件统计
    this.statsEl.replaceChildren(
      this.statLine('外框', v.stats.frame),
      this.statLine('窗心棂条', v.stats.lattice),
      this.statLine('边框装饰', v.stats.border),
      this.statLine('其中用户自绘', v.stats.user),
      this.statLine('杆件总数（段）', v.stats.segments),
    );

    if (v.stats.complexity.overLimit) {
      this.setNotice(v.stats.complexity.message, 'warn');
    }

    // 参数滑杆
    const p = doc.parameters;
    this.setSlider(this.sliders.width, p.width);
    this.setSlider(this.sliders.height, p.height);
    this.setSlider(this.sliders.frameWidth, p.frameWidth);
    this.setSlider(this.sliders.barWidth, p.barWidth);
    this.setSlider(this.sliders.rowCount, p.rowCount ?? 4);
    this.setSlider(this.sliders.columnCount, p.columnCount ?? 4);
    this.setSlider(this.sliders.density, p.density ?? 0.85);
    this.setSlider(this.sliders.seed, p.seed ?? 1);
    this.setSlider(this.sliders.borderRepeat, p.borderRepeat ?? PARAM_LIMITS.defaultBorderRepeat);
    if (this.borderToggle) this.borderToggle.checked = p.borderEnabled === true;

    // 摆放滑杆
    this.setSlider(this.transformSliders.depth, clampSlider(v.transform.z, 1.2, 9.5));
    this.setSlider(this.transformSliders.x, v.transform.x);
    this.setSlider(this.transformSliders.y, v.transform.y);
    this.setSlider(this.transformSliders.rotationY, v.transform.rotationY);
    this.setSlider(this.transformSliders.rotationZ, v.transform.rotationZ);

    // 光源滑杆
    this.setSlider(this.sliders.lightX, v.light.x);
    this.setSlider(this.sliders.lightY, v.light.y);
    this.setSlider(this.sliders.lightZ, Math.max(v.lightLimits.minZ, v.light.z));

    // 读数
    const b = v.metrics.bounds;
    this.metricsEls.get('width')!.textContent = b ? `${b.width.toFixed(3)}` : '—';
    this.metricsEls.get('height')!.textContent = b ? `${b.height.toFixed(3)}` : '—';
    this.metricsEls.get('area')!.textContent = `${v.metrics.shadowArea.toFixed(3)} 单位²`;
    this.metricsEls.get('void')!.textContent = `${(v.metrics.voidRatio * 100).toFixed(1)}%`;
    this.metricsEls.get('boundsArea')!.textContent = `${v.metrics.boundsArea.toFixed(3)} 单位²`;

    // 画布底部状态条：位置 / 深度 / 影子尺寸 / 镂空率直接贴在操作区上，
    // 这样即使把右栏收起（专注画布）也仍然读得到关键数据。
    const pos = `X ${v.transform.x.toFixed(2)}　Y ${v.transform.y.toFixed(2)}　Z ${v.transform.z.toFixed(2)}`;
    const shadow = b ? `影子 ${b.width.toFixed(2)} × ${b.height.toFixed(2)}` : '影子 —';
    const voidRatio = `镂空率 ${(v.metrics.voidRatio * 100).toFixed(1)}%`;
    this.stageStatusEl.textContent = v.drawing
      ? `绘制中：第 ${v.drawNodes} 点 · ${v.drawSegments} 段 — 单击加节点，双击 / Enter 完成折线，Esc 取消（折线为空时退出绘制）`
      : v.selectedStrokeId
        ? `已选中窗格　${pos}　${shadow}　${voidRatio}`
        : `未选中构件：在画布上单击窗格即可拖动　${shadow}　${voidRatio}`;
    this.stageStatusEl.classList.toggle('is-drawing', v.drawing);

    // 视口偏矮时指引卡会滚动：给它一个底部渐隐，别让最后一组"凭空消失"
    this.guideEl.classList.toggle(
      'is-scrollable',
      !v.drawing && this.guideBodyEl.scrollHeight > this.guideBodyEl.clientHeight + 4,
    );
    // 绘制模式收成一条提示：指引卡是浮层，展开状态会盖住画布左上角——
    // 而绘制恰恰需要整块画布都能点。收起后键位仍然写在提示条与底部状态条里。
    this.guideEl.classList.toggle('is-drawing', v.drawing);

    // 自绘工具状态
    this.drawButton.textContent = v.drawing ? '结束绘制' : '画棂条';
    this.drawButton.title = v.drawing
      ? '结束当前折线并退出绘制模式（折线不足 2 点时直接退出）'
      : '进入绘制模式，在窗格上单击添加节点';
    this.drawButton.classList.toggle('btn-active', v.drawing);
    this.finishButton.disabled = !v.drawing;
    this.undoNodeButton.disabled = !v.drawing;
    this.deleteButton.disabled = !v.selectedStrokeId;
    this.undoButton.disabled = !v.canUndo;
    this.redoButton.disabled = !v.canRedo;
    this.snapToggle.checked = v.snap;
    this.raysToggle.checked = v.raysOn;
    this.assistToggle.checked = v.assistOn;
    this.drawHintEl.textContent = v.drawing
      ? `单击添加节点（已有 ${v.drawNodes} 个）；双击或 Enter 结束折线；Esc 取消折线，折线为空时退出绘制。`
      : '点「画棂条」后，在三维视窗里点选节点即可添加一条自己画的棂条。自绘内容标注为「用户创作」。';
    if (v.drawing) {
      this.setNotice(
        `正在绘制：第 ${v.drawNodes} 点 · ${v.drawSegments} 段。双击 / Enter 完成折线，Esc 取消（折线为空时退出绘制）。`,
        'info',
      );
    }

    // 文化卡片
    this.renderCulture(doc);

    // 实验
    this.renderExperiment(v);

    // 提示
    if (v.note) this.setNotice(v.note, 'warn');
    else if (v.notice) this.setNotice(v.notice, 'info');
    else this.hideNotice();

    this.resetExperimentButton.disabled = !v.experiment.running;
  }

  private statLine(label: string, value: number): HTMLElement {
    return h('div', { class: 'stat-row' }, [
      h('span', { class: 'k', text: label }),
      h('span', { class: 'v mono', text: String(value) }),
    ]);
  }

  private renderCulture(doc: WindowDocument): void {
    const card = getCultureCard(doc.isUserCreation ? 'blank' : doc.patternId);
    if (!card) {
      this.cultureEl.replaceChildren(h('h3', { text: '文化资料' }), h('div', { class: 'side-empty', text: '该模板暂无资料卡。' }));
      return;
    }
    const nodes: (HTMLElement | string)[] = [
      h('h3', { text: `纹样档案 · ${card.title}` }),
      h('div', { class: 'culture-field' }, [h('span', { class: 'k', text: '结构特点' }), h('p', { text: card.formDescription })]),
      h('div', { class: 'culture-field' }, [h('span', { class: 'k', text: '本项目怎样生成' }), h('p', { text: card.constructionNote })]),
    ];
    if (card.meaning) {
      nodes.push(h('div', { class: 'culture-field' }, [h('span', { class: 'k', text: '来源记载的语境' }), h('p', { text: card.meaning })]));
    }
    nodes.push(
      h('div', { class: 'culture-model-note' }, [h('span', { class: 'k', text: '数字边界声明' }), h('p', { text: card.modelNote })]),
    );
    const sources = getSources(card.sourceIds);
    nodes.push(
      h('div', { class: 'culture-sources' }, [
        h('span', { class: 'k', text: '资料来源（核查日期 ' }),
        h('span', { class: 'tiny muted', text: sources[0]?.accessedAt ?? '' }),
        h('span', { text: '）' }),
        h(
          'ul',
          {},
          sources.map((s) =>
            h('li', {}, [
              h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: `${s.publisher}《${s.title}》` }),
            ]),
          ),
        ),
      ]),
    );
    this.cultureEl.replaceChildren(...nodes);
  }

  private renderExperiment(v: WorkshopView): void {
    const e = v.experiment;
    this.experimentStepsEl.replaceChildren();
    if (e.running) {
      for (const s of e.steps) this.experimentStepsEl.append(h('li', { text: s }));
    }
    this.experimentNarrativeEl.replaceChildren(
      h('div', { class: 'experiment-title', text: e.running ? `进行中：${e.title}` : '选择一个实验开始' }),
      h('p', { class: 'experiment-text', text: e.narrative }),
    );
    if (!e.running && e.conclusion) {
      this.experimentNarrativeEl.append(h('p', { class: 'tiny muted', text: e.conclusion }));
    }
  }

  private setNotice(text: string, tone: 'info' | 'warn'): void {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.remove('hidden');
    this.noticeEl.classList.toggle('notice-warn', tone === 'warn');
    this.noticeEl.classList.toggle('notice-info', tone === 'info');
  }

  private hideNotice(): void {
    this.noticeEl.classList.add('hidden');
  }

  /**
   * 更新绘制浮层。
   *
   * 三层信息（全部来自 DrawingTool 的真实节点，没有任何装饰性假预览）：
   *   1. **棂条预览**：按当前 `barWidth` 换算到屏幕的粗细画一条半透明带，
   *      所见即所得——它就是这个折线提交后会生成的棂条宽度；
   *   2. **中心折线 + 橡皮筋**：已落节点连线（虚线）+ 最后一个节点到光标的连线，
   *      所以鼠标还没点下去就能看到"下一段会长什么样"；
   *   3. **节点标识**：每个节点带序号，**当前节点**额外有光晕、十字准星与
   *      加粗描边，起点单独用碧玉色区分。
   */
  setDrawPreview(points: Array<{ x: number; y: number }>, barPx = 0): void {
    this.drawPoints = points.slice();
    this.drawBarPx = barPx;
    if (points.length === 0) {
      this.drawHover = null;
      this.drawHoverLocal = null;
    }
    this.renderDrawOverlay();
  }

  /** 悬停点（屏幕坐标 + 窗格局部坐标）——只重画浮层，代价很低 */
  setDrawHover(client: Vec2Data | null, local: Vec2Data | null): void {
    this.drawHover = client;
    this.drawHoverLocal = local;
    if (this.drawOverlay.classList.contains('active')) this.renderDrawOverlay();
  }

  private renderDrawOverlay(): void {
    const rect = this.drawOverlay.getBoundingClientRect();
    const ox = rect.left;
    const oy = rect.top;
    const sx = (p: { x: number }) => (p.x - ox).toFixed(1);
    const sy = (p: { y: number }) => (p.y - oy).toFixed(1);

    // 绘制范围提示框（说明"现在处于绘制模式"）
    this.drawFrame.setAttribute('x', '1');
    this.drawFrame.setAttribute('y', '1');
    this.drawFrame.setAttribute('width', String(Math.max(0, rect.width - 2)));
    this.drawFrame.setAttribute('height', String(Math.max(0, rect.height - 2)));

    const pts = this.drawPoints;
    const poly = pts.map((p) => `${sx(p)},${sy(p)}`).join(' ');
    this.drawGhostLine.setAttribute('points', poly);
    this.drawGhostLine.setAttribute('stroke-width', this.drawBarPx.toFixed(2));
    this.drawPreviewLine.setAttribute('points', poly);

    const last = pts.length ? pts[pts.length - 1] : null;
    const hover = this.drawHover;
    // 橡皮筋只在"已经有起点且鼠标还在窗格上"时出现
    const showRubber = !!last && !!hover;
    this.drawRubberLine.setAttribute('x1', last ? sx(last) : '0');
    this.drawRubberLine.setAttribute('y1', last ? sy(last) : '0');
    this.drawRubberLine.setAttribute('x2', hover ? sx(hover) : '0');
    this.drawRubberLine.setAttribute('y2', hover ? sy(hover) : '0');
    this.drawRubberLine.classList.toggle('hidden', !showRubber);

    this.drawHoverDot.setAttribute('cx', hover ? sx(hover) : '0');
    this.drawHoverDot.setAttribute('cy', hover ? sy(hover) : '0');
    this.drawHoverDot.setAttribute('r', hover ? '4' : '0');
    this.drawHoverDot.classList.toggle('hidden', !hover);

    const local = this.drawHoverLocal;
    this.drawHoverLabel.setAttribute('x', hover ? String(Number(sx(hover)) + 10) : '0');
    this.drawHoverLabel.setAttribute('y', hover ? String(Number(sy(hover)) + 18) : '0');
    this.drawHoverLabel.textContent = local
      ? `${local.x.toFixed(2)}, ${local.y.toFixed(2)}`
      : '';
    this.drawHoverLabel.classList.toggle('hidden', !local);

    this.drawNodeLayer.replaceChildren(
      ...pts.map((p, i) => this.buildNodeMarker(i, Number(sx(p)), Number(sy(p)))),
    );
  }

  /**
   * 单个节点标识。
   * `is-current` = 刚刚落下的那个节点（会被下一段接上），所以给足辨识度；
   * `is-first` = 折线起点，颜色不同，便于判断方向。
   */
  private buildNodeMarker(index: number, x: number, y: number): SVGGElement {
    const NS = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(NS, 'g');
    const isCurrent = index === this.drawPoints.length - 1;
    g.setAttribute('class', `draw-node-item${isCurrent ? ' is-current' : ''}${index === 0 ? ' is-first' : ''}`);

    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] => {
      const el = document.createElementNS(NS, tag);
      el.setAttribute('class', cls);
      return el;
    };

    const ring = mk('circle', 'draw-node-ring');
    ring.setAttribute('cx', String(x));
    ring.setAttribute('cy', String(y));
    ring.setAttribute('r', isCurrent ? '9' : index === 0 ? '6' : '0');
    g.append(ring);

    if (isCurrent) {
      // 十字准星：把"当前节点"从一堆点里一眼挑出来
      for (const [dx1, dy1, dx2, dy2] of [
        [-13, 0, -7, 0],
        [7, 0, 13, 0],
        [0, -13, 0, -7],
        [0, 7, 0, 13],
      ]) {
        const l = mk('line', 'draw-node-cross');
        l.setAttribute('x1', String(x + dx1));
        l.setAttribute('y1', String(y + dy1));
        l.setAttribute('x2', String(x + dx2));
        l.setAttribute('y2', String(y + dy2));
        g.append(l);
      }
    }

    const dot = mk('circle', 'draw-node-dot');
    dot.setAttribute('cx', String(x));
    dot.setAttribute('cy', String(y));
    dot.setAttribute('r', isCurrent ? '5' : '3.5');
    g.append(dot);

    const label = mk('text', 'draw-node-index');
    label.setAttribute('x', String(x + 11));
    label.setAttribute('y', String(y - 8));
    label.textContent = String(index + 1);
    g.append(label);
    return g;
  }

  setDrawOverlayVisible(visible: boolean): void {
    this.drawOverlay.classList.toggle('active', visible);
    if (visible) {
      // 浮层刚从 display:none 变可见：同一帧里量一次尺寸，否则虚线框会是 0×0
      this.renderDrawOverlay();
      return;
    }
    this.drawPoints = [];
    this.drawHover = null;
    this.drawHoverLocal = null;
    this.drawNodeLayer.replaceChildren();
    this.drawPreviewLine.setAttribute('points', '');
    this.drawGhostLine.setAttribute('points', '');
    this.drawRubberLine.classList.add('hidden');
    this.drawHoverDot.classList.add('hidden');
    this.drawHoverLabel.classList.add('hidden');
  }

  /**
   * 把引导实验卡片滚进可视区。
   * 右栏内容较长，实验卡片在默认滚动位置之下；点了实验却看不到面板，
   * 用户会以为"按钮没反应"。开始实验时主动滚动过去。
   */
  revealExperiment(): void {
    this.experimentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  setView(v: ViewState): void {
    this.viewPanel.setView(v);
  }
}

function clampSlider(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/** 指引卡开合状态的存储 key（只影响界面，与作品集 / 关卡存档无关） */
const GUIDE_STORAGE_KEY = 'lightShadow.workshopGuide';
