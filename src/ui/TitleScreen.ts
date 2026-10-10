import { h } from './dom';

/** 标题页：游戏入口。背景由 CSS 生成的一盏灯与漂浮几何体构成。 */

export interface TitleHandlers {
  onStart: () => void;
  onLevelSelect: () => void;
  onLab?: () => void;
}

export class TitleScreen {
  readonly root: HTMLElement;
  private labBtn: HTMLButtonElement;

  constructor(handlers: TitleHandlers, version = 'v1.0.0') {
    const decor = h('div', { class: 'title-decor' }, [
      h('div', { class: 'title-lamp' }),
      h('div', { class: 'deco-shape deco-square' }),
      h('div', { class: 'deco-shape deco-circle' }),
      h('div', { class: 'deco-shape deco-tri' }),
      h('div', { class: 'deco-shape deco-diamond' }),
    ]);

    const labButton = h('button', {
      class: 'btn btn-lg btn-lab',
      text: '自由实验室',
      title: '不设目标，自由摆放几何体与光源',
      onclick: () => handlers.onLab?.(),
    }) as HTMLButtonElement;
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

  /**
   * 自由实验室始终可用（它是一个不设目标的沙盒）。
   * 参数仅用于在全部关卡通关后给按钮加一个完成标记。
   */
  setLabUnlocked(v: boolean): void {
    this.labBtn.classList.toggle('lab-ready', v);
  }
}
