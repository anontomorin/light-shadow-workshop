import { h } from './dom';

/** 暂停面板：继续 / 重新开始 / 操作说明 / 音效开关 / 返回标题页 */

export interface PauseHandlers {
  onResume: () => void;
  onRestart: () => void;
  onHome: () => void;
  onToggleSound: (v: boolean) => void;
  onResetProgress: () => void;
}

export class PausePanel {
  readonly root: HTMLElement;

  constructor(handlers: PauseHandlers, soundEnabled: boolean) {
    const soundSwitch = h('button', {
      class: 'switch',
      role: 'switch',
      'aria-checked': String(soundEnabled),
      'aria-label': '音效开关',
      onclick: (e: Event) => {
        const el = e.currentTarget as HTMLElement;
        const next = el.getAttribute('aria-checked') !== 'true';
        el.setAttribute('aria-checked', String(next));
        handlers.onToggleSound(next);
      },
    });

    const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
      h('h2', { text: '已暂停' }),
      h('div', { class: 'modal-sub', text: '随时可以回到关卡继续创作，进度不会丢失。' }),

      h('div', { class: 'switch-row' }, [h('span', { text: '音效' }), soundSwitch]),

      h('h3', {
        style: { fontSize: '12px', color: 'var(--ink-soft)', margin: '18px 0 8px', letterSpacing: '0.06em' },
        text: '操作说明',
      }),
      h('div', { class: 'keyhint', style: { fontSize: '13px' } }, [
        h('div', {}, ['左键点击物体选中，按住左键在场景中拖动它']),
        h('div', {}, ['在空白处按住左键拖动，可环绕观察整个场景']),
        h('div', {}, ['Q / E 旋转选中物体；右侧面板可调整翻转与深度']),
        h('div', {}, ['光源面板控制灯的左右、高度与远近']),
        h('div', {}, ['影子越接近目标轮廓，匹配度越高；达到阈值即通关']),
        h('div', {}, ['R 重置本关，H 获取提示，Esc 暂停或关闭弹窗']),
      ]),

      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn btn-primary', text: '继续游戏', onclick: handlers.onResume }),
        h('button', { class: 'btn', text: '重新开始', onclick: handlers.onRestart }),
      ]),
      h('div', { class: 'modal-actions', style: { marginTop: '10px' } }, [
        h('button', { class: 'btn btn-ghost', text: '返回标题页', onclick: handlers.onHome }),
        h('button', {
          class: 'btn btn-ghost',
          text: '清除存档',
          onclick: () => {
            if (window.confirm('确定要清除全部关卡进度吗？此操作不可撤销。')) {
              handlers.onResetProgress();
            }
          },
        }),
      ]),
    ]);

    this.root = h('div', { class: 'modal-mask' }, [modal]);
  }
}
