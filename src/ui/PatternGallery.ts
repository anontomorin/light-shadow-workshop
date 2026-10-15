import { h } from './dom';
import { buildDocumentFromPattern, strokeStats } from '../window-builder/WindowDocument';
import { getCultureCard, getSources } from '../culture/patternCatalog';
import { DEFAULT_PARAMETERS } from '../window-builder/GeometryLimits';
import { patternSvgElement } from './patternSvg';
import type { PatternKind, WindowDocument } from '../patterns/types';

/**
 * 模式 A：窗棂初识 / 纹样档案。
 *
 * 目标：先让用户看清"窗棂由哪些构件组成、这些构件在本工具里是怎么生成的"，
 * 再进入花窗工坊动手编辑。
 *
 * 关键点：
 *   - 预览图由 WindowDocument 程序化生成（与编辑器同源），不是外部图片；
 *   - 「拆解结构」只显示窗框 / 只显示窗心，构件数量来自真实统计；
 *   - 每张卡片都列出资料来源链接与"数字示意"边界声明。
 */

export interface PatternGalleryHandlers {
  onPickPattern: (id: PatternKind) => void;
  onClose: () => void;
}

const FEATURED: PatternKind[] = ['step-step-brocade', 'ice-crack-style', 'three-cross-six-bowl-diamond'];

type ViewMode = 'all' | 'frame' | 'lattice';

function filtered(doc: WindowDocument, mode: ViewMode): WindowDocument {
  if (mode === 'all') return doc;
  const role = mode === 'frame' ? 'frame' : 'lattice';
  return { ...doc, strokes: doc.strokes.filter((s) => s.role === role) };
}

export class PatternGallery {
  readonly root: HTMLElement;

  constructor(handlers: PatternGalleryHandlers) {
    const cards = FEATURED.map((id) => this.buildCard(id, handlers));

    const intro = h('div', { class: 'gallery-intro' }, [
      h('h2', { text: '窗棂初识 · 纹样档案' }),
      h('p', {
        class: 'small muted',
        text: '先认识三种有出处的传统窗棂形式，再看它们在《光影工坊》里如何被"拆成一根根棂条"并投影成影子。三个预览都由程序按当前参数即时生成，可以拆解查看构件。',
      }),
    ]);

    this.root = h('div', { class: 'modal-mask' }, [
      h('div', { class: 'modal gallery-modal', role: 'dialog', 'aria-modal': 'true' }, [
        intro,
        h('div', { class: 'gallery-grid' }, cards),
        h('div', { class: 'modal-actions' }, [
          h('button', { class: 'btn', text: '关闭', onclick: () => handlers.onClose() }),
        ]),
      ]),
    ]);
  }

  private buildCard(kind: PatternKind, handlers: PatternGalleryHandlers): HTMLElement {
    const doc = buildDocumentFromPattern({ patternId: kind, parameters: DEFAULT_PARAMETERS });
    const stats = strokeStats(doc);
    const card = getCultureCard(kind);
    const preview = h('div', { class: 'gallery-preview' });
    const meta = h('div', { class: 'tiny muted gallery-meta' });

    const render = (mode: ViewMode) => {
      preview.replaceChildren(patternSvgElement(filtered(doc, mode), { width: 220, height: 300 }));
      meta.textContent =
        mode === 'frame'
          ? `窗框构件 ${stats.frame} 根`
          : mode === 'lattice'
            ? `窗心棂条 ${stats.lattice} 笔 · 共 ${stats.segments} 段杆件`
            : `构件合计 ${stats.total} 笔 · ${stats.segments} 段杆件`;
    };

    const modesRow = h('div', { class: 'gallery-modes' });
    const buttons: Array<[ViewMode, string]> = [
      ['all', '完整'],
      ['frame', '拆解：窗框'],
      ['lattice', '拆解：窗心'],
    ];
    for (const [mode, label] of buttons) {
      const btn = h('button', { class: 'btn btn-sm', text: label }) as HTMLButtonElement;
      btn.onclick = () => {
        render(mode);
        for (const b of Array.from(modesRow.querySelectorAll('button'))) {
          b.classList.toggle('active', b === btn);
        }
      };
      modesRow.append(btn);
    }
    render('all');
    (modesRow.firstElementChild as HTMLElement)?.classList.add('active');

    const sources = card ? getSources(card.sourceIds) : [];

    return h('article', { class: 'gallery-card', 'data-pattern': kind }, [
      h('div', { class: 'gallery-card-head' }, [
        h('h3', { text: card?.title ?? kind }),
        h('span', { class: 'badge', text: '数字示意' }),
      ]),
      preview,
      modesRow,
      meta,
      h('div', { class: 'gallery-field' }, [
        h('span', { class: 'k', text: '结构特点' }),
        h('p', { text: card?.formDescription ?? '' }),
      ]),
      h('div', { class: 'gallery-field' }, [
        h('span', { class: 'k', text: '本项目怎样生成' }),
        h('p', { text: card?.constructionNote ?? '' }),
      ]),
      card?.meaning
        ? h('div', { class: 'gallery-field' }, [
            h('span', { class: 'k', text: '来源记载的语境' }),
            h('p', { text: card.meaning }),
          ])
        : null,
      h('div', { class: 'gallery-model-note' }, [h('p', { text: card?.modelNote ?? '' })]),
      h('div', { class: 'gallery-sources' }, [
        h('span', { class: 'k', text: '来源' }),
        h(
          'ul',
          {},
          sources.map((s) =>
            h('li', {}, [
              h('a', {
                href: s.url,
                target: '_blank',
                rel: 'noopener noreferrer',
                text: `${s.publisher}《${s.title}》`,
              }),
            ]),
          ),
        ),
      ]),
      h('div', { class: 'gallery-actions' }, [
        h('button', {
          class: 'btn btn-primary btn-sm',
          text: '在花窗工坊中编辑这个模板',
          onclick: () => handlers.onPickPattern(kind),
        }),
      ]),
    ]);
  }
}
