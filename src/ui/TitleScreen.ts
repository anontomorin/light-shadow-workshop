import { h } from './dom';

/** 标题页：游戏入口。背景由 CSS 生成的一盏灯与漂浮几何体构成。 */

export interface TitleHandlers {
  onStart: () => void;
  onLevelSelect: () => void;
  onLab?: () => void;
}

export class TitleScreen {
  readonly root: HTMLElement;
  private labBtn: HTMLElement | null = null;

  constructor(handlers: TitleHandlers, version = 'v1.0.0') {
    const decor = h('div', { class: 'title-decor' }, [
      h('div', { class: 'title-lamp' }),
      h('div', { class: 'deco-shape deco-square' }),
      h('div', { class: 'deco-shape deco-circle' }),
      h('div', { class: 'deco-shape deco-tri' }),
      h('div', { class: 'deco-shape deco-diamond' }),
    ]);

    const labButton = h('button', {
      class: 'btn btn-ghost hidden',
      text: '自由实验室',
      onclick: () => handlers.onLab?.(),
    });
    this.labBtn = labButton;

    const content = h('div', { class: 'title-content' }, [
      h('div', { class: 'title-mark', text: '三维空间 · 投影益智' }),
      h('h1', { class: 'title-main', text: '光影工坊' }),
      h('div', { class: 'title-sub', text: '影子设计师' }),
      h('p', {
        class: 'title-desc',
        text: '移动几何体、调整角度与光源，让墙上的影子成为作品。',
      }),
      h('div', { class: 'title-actions' }, [
        h('button', { class: 'btn btn-primary btn-lg', text: '开始创作', onclick: handlers.onStart }),
        h('button', { class: 'btn btn-lg', text: '关卡选择', onclick: handlers.onLevelSelect }),
        labButton,
      ]),
    ]);

    this.root = h('section', { class: 'screen title-screen' }, [
      decor,
      content,
      h('div', { class: 'title-footer', text: `光影工坊 ${version}` }),
    ]);
  }

  setLabUnlocked(v: boolean): void {
    this.labBtn?.classList.toggle('hidden', !v);
  }
}
