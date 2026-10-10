import {
  MASK_H,
  MASK_W,
  WALL_MAX_X,
  WALL_MAX_Y,
  WALL_MIN_X,
  WALL_MIN_Y,
  wallToMask,
  type Point2,
} from './Projector';

/**
 * 将轮廓多边形栅格化为二值掩码。
 *
 * 使用离屏 Canvas 2D：所有多边形以同一纯色填充，读取像素后按 Alpha 阈值生成
 * 二值掩码——这样多个影子重叠时会自然合并为统一的实心轮廓，
 * 不会因颜色混合而产生错误的匹配结果。
 */
export class SilhouetteRasterizer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = MASK_W;
    this.canvas.height = MASK_H;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('无法创建 2D 画布上下文，轮廓匹配功能不可用。');
    }
    this.ctx = ctx;
  }

  /** 把一组世界坐标多边形（墙面坐标系）绘制为掩码 */
  rasterize(polygons: Point2[][]): Uint8Array {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, MASK_W, MASK_H);
    ctx.fillStyle = '#000000';
    // 先按墙面矩形裁剪，避免画布自动裁剪造成的细微差异
    ctx.beginPath();
    ctx.rect(0, 0, MASK_W, MASK_H);
    ctx.clip();

    for (const poly of polygons) {
      if (!poly || poly.length < 3) continue;
      ctx.beginPath();
      for (let i = 0; i < poly.length; i++) {
        const p = wallToMask(poly[i]);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
    }

    const data = ctx.getImageData(0, 0, MASK_W, MASK_H).data;
    const mask = new Uint8Array(MASK_W * MASK_H);
    for (let i = 0, p = 3; i < mask.length; i++, p += 4) {
      mask[i] = data[p] > 127 ? 1 : 0;
    }
    return mask;
  }

  /** 调试用途：把最近的掩码画到一个可见 canvas 上 */
  debugDrawTo(canvas: HTMLCanvasElement, mask: Uint8Array, color = '#2f4858'): void {
    canvas.width = MASK_W;
    canvas.height = MASK_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, MASK_W, MASK_H);
    ctx.fillStyle = color;
    for (let y = 0; y < MASK_H; y++) {
      for (let x = 0; x < MASK_W; x++) {
        if (mask[y * MASK_W + x]) ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  /** 把墙面世界坐标区域转换为画布 CSS 尺寸下的比例，便于调试绘制 */
  static wallBounds() {
    return { minX: WALL_MIN_X, maxX: WALL_MAX_X, minY: WALL_MIN_Y, maxY: WALL_MAX_Y };
  }

  dispose(): void {
    this.canvas.width = 0;
    this.canvas.height = 0;
  }
}
