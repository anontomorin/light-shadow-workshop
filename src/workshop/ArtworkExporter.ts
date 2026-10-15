import { CULTURE_SOURCES } from '../culture/patternCatalog';
import { WALL_MAX_X, WALL_MAX_Y, WALL_MIN_X, WALL_MIN_Y } from '../projection/Projector';
import { MASK_H, MASK_W } from '../projection/Projector';
import type { Point2 } from '../projection/Projector';
import { extractBars, barPlanCorners } from '../window-builder/WindowGeometryBuilder';
import type { WindowDocument } from '../patterns/types';
import type { ArtworkColors } from './ArtworkStore';

/**
 * PNG 作品海报导出。
 *
 * 为什么用独立 Canvas 2D 合成（而不是截屏 WebGL 画布）：
 *   - 分辨率恒定 1920×1080，不受窗口尺寸与设备像素比影响；
 *   - 界面控件不会入图，也不存在 WebGL 跨域纹理污染画布的问题；
 *   - 窗影部分直接来自**真实的投影多边形**（与画面预览、匹配掩码同源），
 *     不是任何静态假图。
 *
 * 资源纪律：临时 object URL 用完立即 revoke；离屏画布用完置零释放。
 */

export const POSTER_WIDTH = 1920;
export const POSTER_HEIGHT = 1080;

export interface PosterInput {
  doc: WindowDocument;
  /** 墙面坐标下的投影多边形（真实计算结果） */
  polygons: Point2[][];
  /** 真实投影掩码（用于兜底绘制与"镂空率"读数） */
  mask: Uint8Array;
  metrics: {
    boundsWidth: number;
    boundsHeight: number;
    shadowArea: number;
    voidRatio: number;
  };
  name: string;
  author: string;
  /** 纹样类别展示名 */
  patternLabel: string;
  /** 参数摘要（已格式化的若干行文本） */
  parameterLines: string[];
  /** 数字示意 / 风格化创作声明 */
  modelNote: string;
  colors: ArtworkColors;
}

const PANEL = {
  left: { x: 96, y: 236, w: 736, h: 640 },
  right: { x: 900, y: 236, w: 924, h: 640 },
};
const FOOTER_Y = 942;

function font(size: number, weight = 400): string {
  return `${weight} ${size}px 'PingFang SC', 'Microsoft YaHei', 'Segoe UI', system-ui, sans-serif`;
}

function fmtDate(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 文件名清理：去掉路径分隔符与保留字符 */
export function sanitizeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40) || '窗格作品'
  );
}

/**
 * 把窗格设计绘制到指定矩形内（2D 正投影，比例自适应）。
 * 只使用文档里的杆件数据，与三维场景中的构件来自同一份 WindowDocument。
 */
function drawDesign(
  ctx: CanvasRenderingContext2D,
  doc: WindowDocument,
  box: { x: number; y: number; w: number; h: number },
  ink: string,
): void {
  const pad = 34;
  const scale = Math.min((box.w - pad * 2) / doc.width, (box.h - pad * 2) / doc.height);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  ctx.save();
  // 窗格底（宣纸白）
  ctx.fillStyle = '#fffdf8';
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = 'rgba(44,58,69,0.18)';
  ctx.lineWidth = 2;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);

  ctx.fillStyle = ink;
  for (const bar of extractBars(doc)) {
    const pts = barPlanCorners(bar);
    ctx.beginPath();
    pts.forEach((p, i) => {
      const X = cx + p.x * scale;
      const Y = cy - p.y * scale;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** 把真实投影多边形绘制到右侧面板（等比映射墙面坐标） */
function drawShadow(
  ctx: CanvasRenderingContext2D,
  polygons: Point2[][],
  box: { x: number; y: number; w: number; h: number },
  colors: ArtworkColors,
): boolean {
  ctx.save();
  const wallW = WALL_MAX_X - WALL_MIN_X;
  const wallH = WALL_MAX_Y - WALL_MIN_Y;
  const scale = Math.min(box.w / wallW, box.h / wallH);
  const offX = box.x + (box.w - wallW * scale) / 2;
  const offY = box.y + (box.h - wallH * scale) / 2;

  // 墙面
  const grd = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.h);
  grd.addColorStop(0, '#fbf6ec');
  grd.addColorStop(1, '#f2e9da');
  ctx.fillStyle = grd;
  ctx.fillRect(offX, offY, wallW * scale, wallH * scale);
  ctx.strokeStyle = 'rgba(44,58,69,0.16)';
  ctx.lineWidth = 2;
  ctx.strokeRect(offX + 0.5, offY + 0.5, wallW * scale - 1, wallH * scale - 1);

  if (polygons.length === 0) {
    ctx.restore();
    return false;
  }

  ctx.fillStyle = colors.ink;
  // 用一条 path 承载全部多边形并按 nonzero 规则填充：
  // 重叠区域只被填一次，颜色完全均匀（与墙面模板缓冲并集同效）。
  ctx.beginPath();
  for (const poly of polygons) {
    if (poly.length < 3) continue;
    poly.forEach((p, i) => {
      const X = offX + (p.x - WALL_MIN_X) * scale;
      const Y = offY + (WALL_MAX_Y - p.y) * scale;
      if (i === 0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    });
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
  return true;
}

/** 兜底：直接放大绘制二值掩码 */
function drawMaskFallback(
  ctx: CanvasRenderingContext2D,
  mask: Uint8Array,
  box: { x: number; y: number; w: number; h: number },
  ink: string,
): void {
  const off = document.createElement('canvas');
  off.width = MASK_W;
  off.height = MASK_H;
  const octx = off.getContext('2d');
  if (!octx) return;
  const img = octx.createImageData(MASK_W, MASK_H);
  const rgb = hexToRgb(ink);
  for (let i = 0; i < mask.length; i++) {
    const o = i * 4;
    if (mask[i]) {
      img.data[o] = rgb.r;
      img.data[o + 1] = rgb.g;
      img.data[o + 2] = rgb.b;
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, box.x, box.y, box.w, box.h);
  ctx.restore();
  off.width = 0;
  off.height = 0;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 49, g: 69, b: 90 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * 渲染海报到一个新的 Canvas（导出与自动化截图共用）。
 * 纯前端、无网络依赖。
 */
export function renderPoster(input: PosterInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建海报画布上下文，导出功能不可用。');

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, POSTER_HEIGHT);
  bg.addColorStop(0, '#fbf7ef');
  bg.addColorStop(1, '#f0e8d9');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);

  // 顶部标题
  ctx.fillStyle = '#2c3a45';
  ctx.font = font(66, 600);
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(input.name || '未命名作品', 96, 140);

  ctx.font = font(28);
  ctx.fillStyle = '#6b7a86';
  ctx.fillText('《光影工坊：窗棂之间》· 传统建筑纹样的数字化探索与光影创作', 96, 186);

  ctx.textAlign = 'right';
  ctx.font = font(26);
  ctx.fillStyle = '#8a97a1';
  ctx.fillText(fmtDate(), POSTER_WIDTH - 96, 140);
  ctx.textAlign = 'left';

  // 面板标题
  ctx.fillStyle = '#1f7f96';
  ctx.font = font(26, 600);
  ctx.fillText('窗格设计', PANEL.left.x, PANEL.left.y - 22);
  ctx.fillText('实际窗影（真实几何投影）', PANEL.right.x, PANEL.right.y - 22);

  drawDesign(ctx, input.doc, PANEL.left, '#8a5a33');
  const drawn = drawShadow(ctx, input.polygons, PANEL.right, input.colors);
  if (!drawn) drawMaskFallback(ctx, input.mask, PANEL.right, input.colors.ink);

  // 底部信息栏
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillRect(96, FOOTER_Y - 40, POSTER_WIDTH - 192, 132);
  ctx.strokeStyle = 'rgba(44,58,69,0.14)';
  ctx.lineWidth = 2;
  ctx.strokeRect(96.5, FOOTER_Y - 39.5, POSTER_WIDTH - 193, 131);

  ctx.fillStyle = '#2c3a45';
  ctx.font = font(24, 600);
  const line1 = `${input.patternLabel}　|　作者：${input.author || '未署名'}　|　创作日期：${fmtDate()}`;
  ctx.fillText(line1, 124, FOOTER_Y);

  ctx.font = font(22);
  ctx.fillStyle = '#4d5b66';
  const params = input.parameterLines.slice(0, 2).join('　|　');
  ctx.fillText(params, 124, FOOTER_Y + 34);

  // 投影读数（真实计算值）
  const readout = `投影尺寸 ${input.metrics.boundsWidth.toFixed(2)} × ${input.metrics.boundsHeight.toFixed(2)} 世界单位　|　影子面积 ${input.metrics.shadowArea.toFixed(2)}　|　镂空率 ${(input.metrics.voidRatio * 100).toFixed(1)}%`;
  ctx.fillText(readout, 124, FOOTER_Y + 68);

  // 声明与来源
  ctx.font = font(18);
  ctx.fillStyle = '#7b8891';
  const sources = CULTURE_SOURCES.filter((s) =>
    ['dpm-window-course', 'dpm-winter-class', 'dpm-sanqiao-liuwan', 'hkpm-window-patterns', 'sh-greenery-window', 'xjtlu-ice-crack'].includes(
      s.id,
    ),
  )
    .slice(0, 4)
    .map((s) => `${s.publisher}`)
    .join('、');
  ctx.fillText(
    `${input.modelNote.slice(0, 64)}…　资料来源：${sources}（详见项目内《文化资料来源表》）`,
    124,
    FOOTER_Y + 96,
  );

  return canvas;
}

/** 导出结果 */
export type ExportResult = { ok: true; fileName: string } | { ok: false; message: string };

/**
 * 导出 PNG 并触发下载。
 * 任何一步失败都返回可读原因，绝不静默失效，也不会丢弃作品数据。
 */
export async function downloadPoster(input: PosterInput): Promise<ExportResult> {
  let url: string | null = null;
  try {
    const canvas = renderPoster(input);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      return { ok: false, message: '画布无法生成 PNG（浏览器拒绝导出）。请重试或缩小窗口后重试。' };
    }
    url = URL.createObjectURL(blob);
    const fileName = `${sanitizeFileName(input.name)}-${fmtDate().replace(/-/g, '')}.png`;
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, fileName };
  } catch (e) {
    return {
      ok: false,
      message: `导出失败：${e instanceof Error ? e.message : String(e)}。作品数据仍保存在本地，可稍后重试。`,
    };
  } finally {
    // 临时 object URL 必须释放，否则会持续占用内存
    if (url) {
      const toRevoke = url;
      window.setTimeout(() => URL.revokeObjectURL(toRevoke), 4000);
    }
  }
}
