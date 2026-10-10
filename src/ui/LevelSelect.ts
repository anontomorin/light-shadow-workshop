import { LEVELS, TOTAL_LEVELS } from '../data/levels';
import { h, RANK_LABEL, stars } from './dom';
import type { GameState } from '../app/GameState';

/** 关卡选择页：展示 6 个关卡卡片与解锁 / 通关状态。 */

export interface LevelSelectHandlers {
  onPick: (id: number) => void;
  onBack: () => void;
}

export class LevelSelect {
  readonly root: HTMLElement;
  private grid: HTMLElement;
  private state: GameState;
  private handlers: LevelSelectHandlers;

  constructor(state: GameState, handlers: LevelSelectHandlers) {
    this.state = state;
    this.handlers = handlers;
    this.grid = h('div', { class: 'level-grid' });

    const header = h('div', { class: 'screen-header' }, [
      h('div', {}, [
        h('h1', { text: '关卡选择' }),
        h('div', {
          class: 'sub',
          text: `共 ${TOTAL_LEVELS} 个关卡，难度逐步提升。通关后可以重玩争取更高评价。`,
        }),
      ]),
      h('button', { class: 'btn', text: '返回标题页', onclick: handlers.onBack }),
    ]);

    this.root = h('section', { class: 'screen level-screen' }, [header, this.grid]);
    this.refresh();
  }

  /** 根据存档刷新卡片状态 */
  refresh(): void {
    this.grid.replaceChildren();
    for (const level of LEVELS) {
      const unlocked = this.state.isUnlocked(level.id);
      const rec = this.state.getRecord(level.id);

      const foot = unlocked
        ? h('div', { class: 'lv-foot' }, [
            rec.cleared
              ? h('span', { class: 'badge badge-success', text: `最佳 ${RANK_LABEL[rec.bestRank]}` })
              : h('span', { class: 'badge', text: '未通关' }),
            stars(rec.bestRank),
          ])
        : h('div', { class: 'lv-foot' }, [h('span', { class: 'badge', text: '🔒 通关前一关解锁' })]);

      const card = h(
        'button',
        {
          class: `level-card${unlocked ? '' : ' locked'}`,
          disabled: !unlocked,
          onclick: () => {
            if (unlocked) this.handlers.onPick(level.id);
          },
        },
        [
          h('div', { class: 'lv-no', text: `LEVEL ${String(level.id).padStart(2, '0')}` }),
          h('div', { class: 'lv-title', text: level.title }),
          h('div', { class: 'lv-desc', text: level.description }),
          foot,
        ],
      );
      this.grid.append(card);
    }
  }
}
