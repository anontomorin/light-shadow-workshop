import { h, sliderRow } from './dom';
import {
  VIEW_LIMITS,
  VIEW_PRESETS,
  type ViewPreset,
  type ViewState,
} from '../scene/SceneManager';

/**
 * 观看视角面板：关卡界面与自由实验室共用。
 *
 * 之所以同时提供滑杆与预设按钮，是因为鼠标环绕（右键拖动）不容易被发现，
 * 而滑杆可以直接、精确地把视角调到想要的位置。
 */

export interface ViewPanelHandlers {
  onViewChange: (part: Partial<ViewState>) => void;
  onViewPreset: (name: ViewPreset) => void;
  onViewReset: () => void;
}

export interface ViewPanel {
  root: HTMLElement;
  setView: (v: ViewState) => void;
}

const PRESET_ORDER: ViewPreset[] = ['three-quarter', 'front', 'top', 'left', 'right'];

export function createViewPanel(handlers: ViewPanelHandlers): ViewPanel {
  const azimuth = sliderRow({
    label: '水平角',
    min: VIEW_LIMITS.minAzimuth,
    max: VIEW_LIMITS.maxAzimuth,
    step: 1,
    value: 0,
    format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => handlers.onViewChange({ azimuth: v }),
  });

  const elevation = sliderRow({
    label: '俯仰角',
    min: VIEW_LIMITS.minElevation,
    max: VIEW_LIMITS.maxElevation,
    step: 1,
    value: 12,
    format: (v) => `${v.toFixed(0)}°`,
    onInput: (v) => handlers.onViewChange({ elevation: v }),
  });

  const distance = sliderRow({
    label: '距离',
    min: VIEW_LIMITS.minDistance,
    max: VIEW_LIMITS.maxDistance,
    step: 0.5,
    value: 22.5,
    format: (v) => v.toFixed(1),
    onInput: (v) => handlers.onViewChange({ distance: v }),
  });

  const presets = h(
    'div',
    { class: 'preset-group' },
    PRESET_ORDER.map((name) =>
      h('button', {
        class: 'btn btn-sm',
        text: VIEW_PRESETS[name].label,
        onclick: () => handlers.onViewPreset(name),
      }),
    ),
  );

  const root = h('div', {}, [
    azimuth.row,
    elevation.row,
    distance.row,
    presets,
    h('div', { class: 'rotate-group', style: { marginTop: '8px' } }, [
      h('button', {
        class: 'btn btn-sm',
        text: '复位视角',
        onclick: () => handlers.onViewReset(),
      }),
    ]),
    h('div', { class: 'tiny muted', style: { marginTop: '8px', lineHeight: '1.6' } }, [
      '右键拖动 = 环绕观察，Shift + 右键 / 中键拖动 = 平移，滚轮 = 缩放。',
    ]),
  ]);

  const setView = (v: ViewState) => {
    azimuth.set(v.azimuth);
    elevation.set(v.elevation);
    distance.set(v.distance);
  };

  return { root, setView };
}
