import { h } from './dom';
import { patternSvgElement } from './patternSvg';
import { buildDocumentFromPattern } from '../window-builder/WindowDocument';
import { clampPatternParameters } from '../window-builder/GeometryLimits';
import { patternDisplayName } from '../patterns/PatternRegistry';
import type { PatternKind } from '../patterns/types';

/**
 * 首页（中国风 · 以花窗工坊为主线）。
 *
 * 设计要点
 *  1. **主视觉是真实产物**：右侧那扇花窗不是图片素材，而是调用纹样生成器的
 *     同一份 `WindowDocument` 画出来的 SVG；影子是同一张图的一次深色绘制
 *     （模糊 + 偏移），所以首页展示的正是工坊里能编出来的东西。
 *  2. **入口分层**：一级入口只有「花窗工坊」；原有的「影形解谜」与「自由实验室」
 *     收进二级入口「光影挑战」（见 ModeSelect），首页因此保持单一主线。
 *  3. 装饰全部由 CSS 生成（宣纸底、回纹边、印章、窗棂暗纹），不含任何位图，
 *     也就没有外部资源依赖。
 *
 * 按钮顺序（`.title-actions .btn`）：
 *   0 进入花窗工坊   1 纹样图鉴   2 光影挑战（二级入口）   3 作品与资料
 */

export interface TitleHandlers {
  /** 一级入口：花窗工坊 */
  onWorkshop: () => void;
  /** 纹样图鉴（窗棂初识） */
  onGallery: () => void;
  /** 二级入口：光影挑战（影形解谜 + 自由实验室） */
  onChallenge: () => void;
  /** 作品与资料 */
  onAbout: () => void;
}

/** 首页主视觉选用的纹样 */
const HERO_PATTERN: PatternKind = 'step-step-brocade';
const HERO_SIZE = { w: 300, h: 452 };

const heroDoc = buildDocumentFromPattern({
  patternId: HERO_PATTERN,
  name: patternDisplayName(HERO_PATTERN),
  parameters: clampPatternParameters({
    width: 2.6,
    height: 3.9,
    frameWidth: 0.22,
    barWidth: 0.1,
    rowCount: 3,
    columnCount: 3,
    seed: 20261015,
    density: 0.85,
  }),
});

export class TitleScreen {
  readonly root: HTMLElement;

  constructor(handlers: TitleHandlers, version = 'v3.0.0') {
    const windowSvg = patternSvgElement(heroDoc, {
      width: HERO_SIZE.w,
      height: HERO_SIZE.h,
      ink: '#7d5230',
      background: 'none',
    });
    windowSvg.classList.add('hero-svg');
    const shadowSvg = patternSvgElement(heroDoc, {
      width: HERO_SIZE.w,
      height: HERO_SIZE.h,
      ink: '#1d2b34',
      background: 'none',
    });
    shadowSvg.classList.add('hero-svg');

    const hero = h('div', { class: 'title-hero' }, [
      h('div', { class: 'hero-shadow' }, [shadowSvg]),
      h('div', { class: 'hero-paper' }),
      h('div', { class: 'hero-window' }, [windowSvg]),
      h('div', { class: 'hero-caption tiny' }, [`${heroDoc.name} · 窗格示意图由纹样生成器实时绘制`]),
    ]);

    const content = h('div', { class: 'title-content' }, [
      h('div', { class: 'title-mark' }, [
        h('span', { class: 'mark-rule' }),
        h('span', { text: '中国传统建筑窗棂 · 光影创作' }),
      ]),
      h('h1', { class: 'title-main', text: '光影工坊' }),
      h('div', { class: 'title-sub', text: '窗 棂 之 間' }),
      h('div', { class: 'title-seal', text: '窗棂', 'aria-hidden': 'true' }),
      h('p', {
        class: 'title-desc',
        text: '认识传统窗棂的构成，编出一扇自己的花窗，再调节灯光与位置 —— 让墙上那一片影子，成为一件作品。',
      }),
      h('div', { class: 'title-actions' }, [
        h('button', {
          class: 'btn btn-primary btn-lg',
          text: '进入花窗工坊',
          title: '参数化花窗编辑，实时真实投影',
          onclick: handlers.onWorkshop,
        }),
        h('button', {
          class: 'btn btn-lg btn-workshop',
          text: '纹样图鉴',
          title: '认识传统纹样与它们的文化来源',
          onclick: handlers.onGallery,
        }),
        h('button', {
          class: 'btn btn-lg btn-challenge',
          text: '光影挑战',
          title: '影形解谜（关卡）与自由实验室',
          onclick: handlers.onChallenge,
        }),
        h('button', {
          class: 'btn btn-lg btn-ghost',
          text: '作品与资料',
          title: '我的作品、文化来源与项目说明',
          onclick: handlers.onAbout,
        }),
      ]),
    ]);

    this.root = h('section', { class: 'screen title-screen' }, [
      h('div', { class: 'title-decor' }, [
        h('div', { class: 'title-moon' }),
        h('div', { class: 'title-lattice-bg' }),
        h('div', { class: 'title-ridge' }),
        h('div', { class: 'title-ridge title-ridge-2' }),
      ]),
      content,
      hero,
      h('div', { class: 'title-footer', text: `光影工坊 · 窗棂之间 ${version}` }),
    ]);
  }
}
