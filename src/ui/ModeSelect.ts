import { h } from './dom';
import { LEVELS, TOTAL_LEVELS } from '../data/levels';
import { LAB_SHAPES, LAB_MAX_OBJECTS } from '../gameplay/LabSession';
import type { GameState } from '../app/GameState';

/**
 * 二级入口页「光影挑战」。
 *
 * 本轮把首页收敛成单一主线（花窗工坊），原有的两个玩法 ——
 * **影形解谜**（十个关卡的几何投影挑战）与**自由实验室**（不设目标的沙盒）——
 * 移到这里，作为二级入口。首页只保留一个「光影挑战」按钮。
 *
 * 页面本身不承载任何玩法逻辑，只做两件事：展示进度、把点击转给主控。
 */

export interface ModeSelectHandlers {
  onLevels: () => void;
  onLab: () => void;
  onBack: () => void;
}

/** 「影形解谜」卡片插图：物体与它被光源投出的影子 */
function levelsIcon(): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML =
    `<svg viewBox="0 0 120 90" role="img" aria-label="投影示意">` +
    `<rect x="6" y="8" width="108" height="74" rx="3" fill="none" stroke="currentColor" stroke-opacity="0.35"/>` +
    `<g fill="currentColor" opacity="0.22">` +
    `<path d="M18 46 L44 30 L74 40 L92 26 L96 62 L52 72 Z"/>` +
    `</g>` +
    `<g fill="none" stroke="currentColor" stroke-opacity="0.7" stroke-width="1.6">` +
    `<path d="M18 46 L44 30 L74 40 L92 26 L96 62 L52 72 Z"/>` +
    `</g>` +
    `<rect x="44" y="34" width="22" height="16" fill="currentColor" opacity="0.85"/>` +
    `<circle cx="88" cy="18" r="5" fill="currentColor" opacity="0.9"/>` +
    `<path d="M88 24 L52 44 M88 24 L62 60 M88 24 L92 44" stroke="currentColor" stroke-opacity="0.35" stroke-dasharray="3 3"/>` +
    `</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

/** 「自由实验室」卡片插图：一组可自由摆放的几何形状 */
function labIcon(): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML =
    `<svg viewBox="0 0 120 90" role="img" aria-label="几何形状">` +
    `<rect x="10" y="30" width="24" height="24" fill="currentColor" opacity="0.75"/>` +
    `<circle cx="60" cy="42" r="14" fill="currentColor" opacity="0.55"/>` +
    `<path d="M96 26 L110 52 L82 52 Z" fill="currentColor" opacity="0.8"/>` +
    `<path d="M40 74 L48 62 L60 68 L54 80 Z" fill="currentColor" opacity="0.5"/>` +
    `<path d="M62 60 L70 66 L68 78 L56 78 L54 66 Z" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `<ellipse cx="34" cy="72" rx="12" ry="7" fill="none" stroke="currentColor" stroke-width="2"/>` +
    `</svg>`;
  return wrap.firstElementChild as SVGSVGElement;
}

export class ModeSelect {
  readonly root: HTMLElement;
  private levelsFoot: HTMLElement;
  private state: GameState;

  constructor(state: GameState, handlers: ModeSelectHandlers) {
    this.state = state;

    const backBtn = h('button', {
      class: 'btn btn-icon',
      title: '返回标题页',
      'aria-label': '返回标题页',
      text: '←',
      onclick: handlers.onBack,
    });

    this.levelsFoot = h('div', { class: 'mode-foot' });

    const levelsCard = this.card({
      key: 'levels',
      badge: '挑战',
      title: '影形解谜',
      subtitle: `${TOTAL_LEVELS} 关 · 真实几何投影 + 轮廓匹配`,
      icon: levelsIcon(),
      body:
        '拖动、旋转几何体与花窗构件，让墙上的影子与目标轮廓重合。' +
        '前六关由方块、圆盘一路走到飞鸟与城市天际线；' +
        '第 7 关起题目取自经典花窗 —— 方格窗十字棂、菱花窗三交六椀、冰裂纹、圆光窗总成。' +
        '影子里那些窗格之间的空隙，是判定的一部分，必须真的对上。',
      foot: this.levelsFoot,
      actionText: '进入关卡',
      onAction: handlers.onLevels,
    });

    const labCard = this.card({
      key: 'lab',
      badge: '沙盒',
      title: '自由实验室',
      subtitle: `${LAB_SHAPES.length} 种形状 · 最多 ${LAB_MAX_OBJECTS} 个物体`,
      icon: labIcon(),
      body:
        '不设目标、不计分：添加几何体，随意拖动、旋转、调整深度与光源，观察影子怎么变。' +
        '除三角形、方形、圆形、六边形、菱形、长方形外，还有五边形、八边形、梯形、半圆，' +
        '以及十字形、五角星、圆环这三个带镂空的凹形 —— 它们的中空同样会被如实投影。',
      actionText: '进入实验室',
      onAction: handlers.onLab,
    });

    const header = h('div', { class: 'screen-header mode-header' }, [
      backBtn,
      h('div', {}, [
        h('h1', { text: '光影挑战' }),
        h('div', {
          class: 'sub',
          text: '这里收着两个以"影子"为核心的玩法。首页的花窗工坊负责创作，这里负责闯关与试手。',
        }),
      ]),
      h('div', { class: 'header-actions' }, [
        h('button', { class: 'btn btn-sm', text: '返回标题页', onclick: handlers.onBack }),
      ]),
    ]);

    this.root = h('section', { class: 'screen mode-screen' }, [
      h('div', { class: 'mode-decor' }),
      header,
      h('div', { class: 'mode-grid' }, [levelsCard, labCard]),
    ]);

    this.refresh();
  }

  private card(opts: {
    key: string;
    badge: string;
    title: string;
    subtitle: string;
    icon: SVGSVGElement;
    body: string;
    foot?: HTMLElement;
    actionText: string;
    onAction: () => void;
  }): HTMLElement {
    return h('article', { class: `mode-card mode-${opts.key}` }, [
      h('div', { class: 'mode-icon' }, [opts.icon]),
      h('div', { class: 'mode-head' }, [
        h('span', { class: 'mode-badge', text: opts.badge }),
        h('h2', { class: 'mode-title', text: opts.title }),
        h('div', { class: 'mode-subtitle', text: opts.subtitle }),
      ]),
      h('p', { class: 'mode-body', text: opts.body }),
      opts.foot ?? h('div', { class: 'mode-foot' }),
      h('div', { class: 'mode-actions' }, [
        h('button', { class: 'btn btn-primary', text: opts.actionText, onclick: opts.onAction }),
      ]),
    ]);
  }

  /** 刷新闯关进度（每次进入本页都会调用） */
  refresh(): void {
    const cleared = LEVELS.filter((l) => this.state.getRecord(l.id).cleared).length;
    const nextId = LEVELS.find((l) => !this.state.getRecord(l.id).cleared)?.id ?? null;
    const best = LEVELS.reduce((acc, l) => Math.max(acc, this.state.getRecord(l.id).bestIou), 0);
    this.levelsFoot.replaceChildren(
      h('span', { class: 'badge badge-primary', text: `已通关 ${cleared} / ${TOTAL_LEVELS}` }),
      h('span', { class: 'badge', text: nextId ? `下一关：第 ${nextId} 关` : '全部通关' }),
      h('span', { class: 'badge badge-accent', text: `最佳匹配度 ${best.toFixed(3)}` }),
    );
  }
}
