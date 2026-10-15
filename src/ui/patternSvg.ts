import { extractBars, barPlanCorners } from '../window-builder/WindowGeometryBuilder';
import type { WindowDocument } from '../patterns/types';

/**
 * 把窗格文档画成一张二维示意图（SVG 字符串）。
 *
 * 与三维场景使用同一份 WindowDocument / 同一套杆件拆解，
 * 所以缩略图与实际编辑对象不会脱节；也不依赖任何外部图片资源。
 * 用于「纹样初识」画廊与「作品集」缩略图。
 */
export function patternSvg(
  doc: WindowDocument,
  opts: { width: number; height: number; ink?: string; background?: string; pad?: number } = {
    width: 240,
    height: 320,
  },
): string {
  const pad = opts.pad ?? 10;
  const ink = opts.ink ?? '#8a5a33';
  const bg = opts.background ?? '#fffdf8';
  const scale = Math.min((opts.width - pad * 2) / doc.width, (opts.height - pad * 2) / doc.height);
  const cx = opts.width / 2;
  const cy = opts.height / 2;

  const paths: string[] = [];
  for (const bar of extractBars(doc)) {
    const pts = barPlanCorners(bar)
      .map((p) => `${(cx + p.x * scale).toFixed(2)},${(cy - p.y * scale).toFixed(2)}`)
      .join(' ');
    paths.push(`<polygon points="${pts}" fill="${ink}" />`);
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${opts.width} ${opts.height}" ` +
    `width="${opts.width}" height="${opts.height}" role="img" aria-label="窗格示意">` +
    `<rect width="${opts.width}" height="${opts.height}" fill="${bg}" rx="10" />` +
    paths.join('') +
    `</svg>`
  );
}

/** 生成可直接插入 DOM 的 SVG 元素（避免 innerHTML 注入面） */
export function patternSvgElement(
  doc: WindowDocument,
  opts: { width: number; height: number; ink?: string; background?: string } = {
    width: 240,
    height: 320,
  },
): SVGSVGElement {
  const wrap = document.createElement('div');
  wrap.innerHTML = patternSvg(doc, opts);
  return wrap.firstElementChild as SVGSVGElement;
}
