import { h, sliderRow } from './dom';
import { createViewPanel, type ViewPanel } from './viewPanel';
import { SHAPE_LABEL } from '../scene/GeometryFactory';
import { OBJECT_LIMITS } from '../projection/Projector';
import { LAB_MAX_OBJECTS, LAB_SHAPES } from '../gameplay/LabSession';
import type { LightState } from '../gameplay/LightController';
import type { ShadowObjectDefinition, ShapeType, Transform3D } from '../gameplay/LevelData';
import type { ViewPreset, ViewState } from '../scene/SceneManager';
import type { LightLimits } from './GameHUD';

/** 自由实验室界面：三维舞台 + 添加/编辑面板 + 视角与光源控制 */

const ROTATE_STEP = 5;

export interface LabHUDHandlers {
  onBack: () => void;
  onAddShape: (shape: ShapeType) => void;
  onSelectObject: (id: string) => void;
  onRotate: (delta: number) => void;
  onRotateTo: (deg: number) => void;
  onFlip: (deg: number) => void;
  onDepth: (z: number) => void;
  onDeleteObject: () => void;
  onResetScene: () => void;
  onLightAxis: (axis: 'x' | 'y' | 'z', value: number) => void;
  onViewChange: (part: Partial<ViewState>) => void;
  onViewPreset: (name: ViewPreset) => void;
  onViewReset: () => void;
}

export class LabHUD {
  readonly root: HTMLElement;
  readonly stageEl: HTMLElement;
  readonly modalHost: HTMLElement;

  private handlers: LabHUDHandlers;

  private chipsEl: HTMLElement;
  private objectPanel: HTMLElement;
  private objectBody: HTMLElement;
  private lightBody: HTMLElement;
  private countEl: HTMLElement;
  private emptyHint: HTMLElement;

  private depthSlider: ReturnType<typeof sliderRow> | null = null;
  private flipSlider: ReturnType<typeof sliderRow> | null = null;
  private rotSlider: ReturnType<typeof sliderRow> | null = null;
  private lightSliders: Record<string, ReturnType<typeof sliderRow>> = {};
  private readoutEls: Record<string, HTMLElement> = {};
  private addButtons = new Map<ShapeType, HTMLButtonElement>();

  private viewPanel: ViewPanel;

  constructor(handlers: LabHUDHandlers) {
    this.handlers = handlers;

    // ---------- 顶部栏 ----------
    const topbar = h('div', { class: 'game-topbar' }, [
      h('button', {
        class: 'btn btn-icon',
        title: '返回标题页',
        'aria-label': '返回标题页',
        text: '←',
        onclick: handlers.onBack,
      }),
      h('div', { class: 'topbar-info' }, [
        h('div', { class: 'lv', text: 'SANDBOX' }),
        h('div', { class: 'name', text: '自由实验室' }),
      ]),
      h('div', { class: 'topbar-spacer' }),
      h('span', { class: 'badge badge-primary', text: '无目标 · 自由创作' }),
    ]);

    // ---------- 舞台 ----------
    this.stageEl = h('div', { class: 'stage' });
    const stageWrap = h('div', { class: 'stage-wrap' }, [
      this.stageEl,
      topbar,
      h('div', { class: 'tutorial-bar' }, [
        '松开目标，随意摆放几何体：添加形状、拖动位置、旋转角度、调整光源，观察影子如何变化。',
      ]),
    ]);
    this.modalHost = stageWrap;

    // ---------- 添加几何体 ----------
    const addGrid = h(
      'div',
      { class: 'lab-add-grid' },
      LAB_SHAPES.map((s) => {
        const btn = h('button', {
          class: 'btn btn-sm',
          text: SHAPE_LABEL[s.shape],
          onclick: () => this.handlers.onAddShape(s.shape),
        }) as HTMLButtonElement;
        this.addButtons.set(s.shape, btn);
        return btn;
      }),
    );

    // ---------- 选中物体 ----------
    this.chipsEl = h('div', { class: 'object-chips' });
    this.objectBody = h('div', {});
    this.objectPanel = h('div', { class: 'side-section' }, [
      h('h3', { text: '选中物体' }),
      this.objectBody,
    ]);

    // ---------- 光源 ----------
    this.lightBody = h('div', {});
    this.lightSliders = {};
    const mkLight = (axis: 'x' | 'y' | 'z', label: string, min: number, max: number) => {
      const s = sliderRow({
        label,
        min,
        max,
        step: 0.1,
        value: axis === 'x' ? 0 : axis === 'y' ? 5.5 : 14,
        onInput: (v) => this.handlers.onLightAxis(axis, v),
      });
      this.lightSliders[axis] = s;
      this.lightBody.append(s.row);
    };
    mkLight('x', '水平', -6, 6);
    mkLight('y', '高度', 2.5, 9.5);
    mkLight('z', '距离', 10, 20);

    this.viewPanel = createViewPanel({
      onViewChange: handlers.onViewChange,
      onViewPreset: handlers.onViewPreset,
      onViewReset: handlers.onViewReset,
    });

    // ---------- 底部操作坞 ----------
    this.countEl = h('span', { class: 'badge', text: `物体 0 / ${LAB_MAX_OBJECTS}` });
    const dock = h('div', { class: 'game-dock' }, [
      this.countEl,
      h('div', { class: 'dock-actions' }, [
        h('button', {
          class: 'btn btn-sm',
          text: '重置场景',
          onclick: () => this.handlers.onResetScene(),
        }),
        h('button', {
          class: 'btn btn-sm btn-primary',
          text: '返回标题页',
          onclick: () => this.handlers.onBack(),
        }),
      ]),
    ]);

    this.emptyHint = h('div', {
      class: 'side-empty',
      text: '还没有物体，点击上方按钮添加一个几何体。',
    });

    const sidePanel = h('aside', { class: 'side-panel' }, [
      h('div', { class: 'side-section' }, [h('h3', { text: '场景物体' }), this.chipsEl]),
      h('div', { class: 'side-section' }, [h('h3', { text: '添加几何体' }), addGrid]),
      this.objectPanel,
      h('div', { class: 'side-section' }, [h('h3', { text: '观看视角' }), this.viewPanel.root]),
      h('div', { class: 'side-section' }, [h('h3', { text: '光源控制' }), this.lightBody]),
      h('div', { class: 'side-section' }, [
        h('h3', { text: '操作说明' }),
        h('div', { class: 'keyhint' }, [
          h('div', {}, ['左键点物体 = 选中；按住拖动 = 移动']),
          h('div', {}, [`Q / E = 旋转 ${ROTATE_STEP}°（Shift 加速）；方向键微调位置`]),
          h('div', {}, ['左键拖空白处 = 环绕视角；滚轮 = 缩放']),
          h('div', {}, ['自由实验室不设目标与评分，随时可以重置场景。']),
        ]),
      ]),
    ]);

    this.root = h('section', { class: 'screen lab-screen' }, [stageWrap, sidePanel, dock]);
  }

  /** 重建物体列表与选中状态 */
  setObjects(defs: ShadowObjectDefinition[]): void {
    this.chipsEl.replaceChildren();
    if (defs.length === 0) {
      this.chipsEl.append(this.emptyHint);
    } else {
      for (const obj of defs) {
        const chip = h(
          'button',
          {
            class: 'chip',
            'aria-pressed': 'false',
            onclick: () => this.handlers.onSelectObject(obj.id),
          },
          [h('span', { class: 'dot', style: { background: obj.color } }), obj.name],
        );
        chip.dataset.id = obj.id;
        this.chipsEl.append(chip);
      }
    }

    // 选中物体控制区（固定结构，随选中状态启用/禁用）
    this.objectBody.replaceChildren();
    this.depthSlider = null;
    this.flipSlider = null;
    this.rotSlider = null;
    this.readoutEls = {};

    const grid = h('div', { class: 'readout-grid' });
    const addReadout = (key: string, label: string) => {
      const v = h('span', { class: 'v', text: '—' });
      grid.append(h('span', { text: `${label}：` }), v);
      this.readoutEls[key] = v;
    };
    addReadout('rotZ', '旋转');
    addReadout('rotY', '翻转');
    addReadout('z', '深度');
    addReadout('xy', '位置');
    this.objectBody.append(grid);

    this.objectBody.append(
      h('h3', { text: '旋转（面内）' }),
      h('div', { class: 'rotate-group' }, [
        h('button', {
          class: 'btn btn-sm',
          text: `↺ ${ROTATE_STEP}°`,
          onclick: () => this.handlers.onRotate(-ROTATE_STEP),
        }),
        h('button', {
          class: 'btn btn-sm',
          text: `↻ ${ROTATE_STEP}°`,
          onclick: () => this.handlers.onRotate(ROTATE_STEP),
        }),
      ]),
    );
    this.rotSlider = sliderRow({
      label: '角度',
      min: -180,
      max: 180,
      step: 1,
      value: 0,
      format: (v) => `${v.toFixed(0)}°`,
      onInput: (v) => this.handlers.onRotateTo(v),
    });
    this.objectBody.append(h('div', { style: { marginTop: '10px' } }), this.rotSlider.row);

    this.flipSlider = sliderRow({
      label: '翻转',
      min: -60,
      max: 60,
      step: 1,
      value: 0,
      format: (v) => `${v.toFixed(0)}°`,
      onInput: (v) => this.handlers.onFlip(v),
    });
    this.objectBody.append(h('div', { style: { marginTop: '10px' } }), this.flipSlider.row);

    this.depthSlider = sliderRow({
      label: '深度',
      min: OBJECT_LIMITS.minZ,
      max: OBJECT_LIMITS.maxZ,
      step: 0.1,
      value: 3.4,
      format: (v) => v.toFixed(1),
      onInput: (v) => this.handlers.onDepth(v),
    });
    this.objectBody.append(h('div', { style: { marginTop: '10px' } }), this.depthSlider.row);

    this.objectBody.append(
      h('div', { class: 'rotate-group', style: { marginTop: '12px' } }, [
        h('button', {
          class: 'btn btn-sm',
          text: '删除选中物体',
          onclick: () => this.handlers.onDeleteObject(),
        }),
      ]),
    );

    this.setCount(defs.length);
  }

  setCount(n: number): void {
    this.countEl.textContent = `物体 ${n} / ${LAB_MAX_OBJECTS}`;
    const full = n >= LAB_MAX_OBJECTS;
    for (const btn of this.addButtons.values()) btn.disabled = full;
  }

  setSelected(def: ShadowObjectDefinition | null, t?: Transform3D): void {
    for (const chip of Array.from(this.chipsEl.children) as HTMLElement[]) {
      if (chip.classList.contains('chip')) {
        chip.setAttribute('aria-pressed', String(!!def && chip.dataset.id === def.id));
      }
    }
    if (!def) {
      this.objectPanel.classList.add('disabled');
      return;
    }
    this.objectPanel.classList.remove('disabled');
    if (!t) return;
    if (this.readoutEls.rotZ) this.readoutEls.rotZ.textContent = `${t.rotationZ.toFixed(0)}°`;
    if (this.readoutEls.rotY) this.readoutEls.rotY.textContent = `${t.rotationY.toFixed(0)}°`;
    if (this.readoutEls.z) this.readoutEls.z.textContent = t.z.toFixed(1);
    if (this.readoutEls.xy) this.readoutEls.xy.textContent = `${t.x.toFixed(1)}, ${t.y.toFixed(1)}`;
    this.rotSlider?.set(t.rotationZ);
    this.flipSlider?.set(t.rotationY);
    this.depthSlider?.set(t.z);
  }

  setLight(light: LightState, limits: LightLimits): void {
    this.lightSliders.x?.set(light.x);
    this.lightSliders.y?.set(light.y);
    const z = this.lightSliders.z;
    if (z) {
      z.input.min = String(limits.minZ);
      z.input.max = String(limits.maxZ);
      z.set(Math.min(limits.maxZ, Math.max(limits.minZ, light.z)));
    }
  }

  setView(v: ViewState): void {
    this.viewPanel.setView(v);
  }
}
