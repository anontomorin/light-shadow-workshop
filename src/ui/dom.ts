/**
 * 极简 DOM 构造工具，用于在 TypeScript 中声明式地创建界面，
 * 避免在代码里拼接大段 HTML 字符串。
 */

type AttrValue =
  | string
  | number
  | boolean
  | EventListener
  | Record<string, string>
  | null
  | undefined;

export interface ElAttrs {
  [key: string]: AttrValue;
}

export type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: ElAttrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key === 'text') el.textContent = String(value);
    else if (key === 'html') el.innerHTML = String(value);
    else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value as Record<string, string>);
    } else {
      el.setAttribute(key, value === true ? '' : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

/** 创建滑杆行：标签 + 滑杆 + 数值 */
export function sliderRow(opts: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}): { row: HTMLElement; input: HTMLInputElement; valueLabel: HTMLElement; set: (v: number) => void } {
  const fmt = opts.format ?? ((v: number) => v.toFixed(1));
  const valueLabel = h('span', { class: 'slider-value', text: fmt(opts.value) });
  const input = h('input', {
    type: 'range',
    min: String(opts.min),
    max: String(opts.max),
    step: String(opts.step),
    value: String(opts.value),
  }) as HTMLInputElement;
  input.addEventListener('input', () => {
    const v = Number(input.value);
    valueLabel.textContent = fmt(v);
    opts.onInput(v);
  });
  const row = h('div', { class: 'slider-row' }, [
    h('label', { text: opts.label }),
    input,
    valueLabel,
  ]);
  const set = (v: number) => {
    input.value = String(v);
    valueLabel.textContent = fmt(v);
  };
  return { row, input, valueLabel, set };
}

/** 星级标记 */
export function stars(rank: 'none' | 'complete' | 'excellent' | 'master'): HTMLElement {
  const n = rank === 'none' ? 0 : rank === 'complete' ? 1 : rank === 'excellent' ? 2 : 3;
  return h(
    'span',
    { class: 'stars', title: rank === 'none' ? '未通关' : `${n} 星` },
    [0, 1, 2].map((i) =>
      h('span', { class: i < n ? 'star-on' : 'star-off', text: '★' }),
    ),
  );
}

export const RANK_LABEL: Record<'none' | 'complete' | 'excellent' | 'master', string> = {
  none: '未通关',
  complete: '完成',
  excellent: '优秀',
  master: '大师',
};
