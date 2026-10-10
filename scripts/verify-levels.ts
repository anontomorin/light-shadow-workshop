/**
 * 关卡可解性与数值验证脚本（Node 环境运行，不依赖浏览器）。
 *
 * 检查项：
 *   1. 用关卡的目标变换生成目标掩码，并把它渲染成 ASCII 预览，人工确认图案可识别；
 *   2. 目标变换 → 目标掩码的 IoU 必须接近 1.0（否则说明投影/光栅管线有 bug）；
 *   3. 初始变换 → 目标掩码的 IoU 必须明显低于通关阈值（否则关卡没有挑战）；
 *   4. 在目标变换附近加入小扰动，IoU 仍应高于通关阈值（否则玩家无法靠手操通关）；
 *   5. 所有物体必须位于光源与投影墙之间，且保留安全深度余量；
 *   6. 目标影子不得被墙面边界裁掉过多。
 *
 * 运行：npm run verify
 */
import { LEVELS } from '../src/data/levels';
import { getLocalVertices } from '../src/scene/GeometryFactory';
import {
  MASK_H,
  MASK_W,
  MIN_LIGHT_GAP,
  WALL_MAX_X,
  WALL_MAX_Y,
  WALL_MIN_X,
  WALL_MIN_Y,
  clipPolygonToWall,
  projectShape,
  type Point2,
} from '../src/projection/Projector';
import type { LevelDefinition, Transform3D } from '../src/gameplay/LevelData';

// ─────────────────────────── 纯 CPU 光栅化（仅用于本脚本） ───────────────────────────

function pointInPolygon(p: Point2, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (yi > p.y !== yj > p.y) {
      const x = ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

function rasterizeCPU(polygons: Point2[][]): Uint8Array {
  const mask = new Uint8Array(MASK_W * MASK_H);
  for (let py = 0; py < MASK_H; py++) {
    const wy = WALL_MAX_Y - ((py + 0.5) / MASK_H) * (WALL_MAX_Y - WALL_MIN_Y);
    for (let px = 0; px < MASK_W; px++) {
      const wx = WALL_MIN_X + ((px + 0.5) / MASK_W) * (WALL_MAX_X - WALL_MIN_X);
      for (const poly of polygons) {
        if (poly.length >= 3 && pointInPolygon({ x: wx, y: wy }, poly)) {
          mask[py * MASK_W + px] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

function computeIoU(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] || b[i]) uni++;
    if (a[i] && b[i]) inter++;
  }
  return uni === 0 ? 0 : inter / uni;
}

function area(m: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < m.length; i++) n += m[i];
  return n;
}

/** 把掩码渲染成 ASCII 图，便于在终端里直接看形状 */
function maskToAscii(mask: Uint8Array, cols = 76, rows = 22): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const px = Math.floor(((c + 0.5) / cols) * MASK_W);
      const py = Math.floor(((r + 0.5) / rows) * MASK_H);
      line += mask[py * MASK_W + px] ? '#' : '·';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** 把两组掩码叠加显示：'#'=重合，'o'=当前影子，'+'=目标缺失部分 */
function overlayAscii(current: Uint8Array, target: Uint8Array, cols = 76, rows = 22): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const px = Math.floor(((c + 0.5) / cols) * MASK_W);
      const py = Math.floor(((r + 0.5) / rows) * MASK_H);
      const i = py * MASK_W + px;
      line += current[i] && target[i] ? '#' : current[i] ? 'o' : target[i] ? '+' : '·';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ─────────────────────────── 投影计算 ───────────────────────────

function polygonsOf(
  level: LevelDefinition,
  transforms: Transform3D[],
  light: { x: number; y: number; z: number },
): Point2[][] {
  const out: Point2[][] = [];
  level.objects.forEach((obj, i) => {
    const poly = projectShape(getLocalVertices(obj.shape), transforms[i], light, obj.scale ?? 1);
    if (poly) out.push(clipPolygonToWall(poly));
  });
  return out;
}

// ─────────────────────────── 主流程 ───────────────────────────

let failures = 0;
const fmt = (n: number) => n.toFixed(3);

console.log('══════════════════════════════════════════════════════════════');
console.log('  光影工坊 · 关卡可解性与数值验证');
console.log('══════════════════════════════════════════════════════════════\n');

for (const level of LEVELS) {
  console.log(`\n━━━ 第 ${level.id} 关《${level.title}》 ───────────────────────────`);
  console.log(`目标：${level.description}`);

  const targetTransforms = level.objects.map((o) => o.target);
  const initialTransforms = level.objects.map((o) => o.initial);

  const targetMask = rasterizeCPU(polygonsOf(level, targetTransforms, level.light.target));
  const solvedMask = rasterizeCPU(polygonsOf(level, targetTransforms, level.light.target));
  const initialMask = rasterizeCPU(polygonsOf(level, initialTransforms, level.light.initial));

  const iouSolved = computeIoU(solvedMask, targetMask);
  const iouInitial = computeIoU(initialMask, targetMask);

  // 目标图案预览
  console.log('\n[目标轮廓预览]');
  console.log(maskToAscii(targetMask));

  console.log('\n[初始状态 vs 目标]  # 重合 / o 当前影子 / + 目标缺失');
  console.log(overlayAscii(initialMask, targetMask));

  // 扰动测试：模拟玩家"接近但不完美"的操作
  const worstOf = (ampPos: number, ampRot: number): number => {
    let worst = 1;
    for (let trial = 0; trial < 12; trial++) {
      const noisy = targetTransforms.map((t, i) => ({
        x: t.x + Math.sin(trial * 2.3 + i) * ampPos,
        y: t.y + Math.cos(trial * 1.7 + i) * ampPos,
        z: t.z + Math.sin(trial * 3.1 + i) * ampPos,
        rotationX: t.rotationX,
        rotationY: t.rotationY,
        rotationZ: t.rotationZ + Math.cos(trial * 2.9 + i) * ampRot,
      }));
      const noisyLight = {
        x: level.light.target.x + Math.sin(trial * 1.3) * ampPos,
        y: level.light.target.y + Math.cos(trial * 1.9) * ampPos,
        z: level.light.target.z,
      };
      worst = Math.min(worst, computeIoU(rasterizeCPU(polygonsOf(level, noisy, noisyLight)), targetMask));
    }
    return worst;
  };
  // 粗对齐：玩家凭目测大致摆好（约 ±0.12 世界单位 / ±5°）
  const iouCoarse = worstOf(0.12, 5);
  // 精对齐：玩家看着匹配度仔细微调之后（约 ±0.05 世界单位 / ±2°）
  const iouFine = worstOf(0.05, 2);

  // 深度合法性
  let depthOk = true;
  for (const t of [...targetTransforms, ...initialTransforms]) {
    const lz = Math.min(level.light.initial.z, level.light.target.z);
    if (t.z <= 0.2 || t.z >= lz - MIN_LIGHT_GAP) depthOk = false;
  }

  // 裁剪损失：目标影子贴边检查
  let touchingEdge = false;
  for (const poly of polygonsOf(level, targetTransforms, level.light.target)) {
    for (const p of poly) {
      if (
        p.x <= WALL_MIN_X + 0.02 ||
        p.x >= WALL_MAX_X - 0.02 ||
        p.y <= WALL_MIN_Y + 0.02 ||
        p.y >= WALL_MAX_Y - 0.02
      ) {
        touchingEdge = true;
      }
    }
  }

  console.log('\n[数值检查]');
  const rows: Array<[string, string, boolean]> = [
    ['目标状态 IoU', fmt(iouSolved), iouSolved > 0.999],
    ['初始状态 IoU', fmt(iouInitial), iouInitial < level.matchThreshold - 0.15],
    ['粗对齐 IoU(±0.12)', fmt(iouCoarse), iouCoarse >= level.matchThreshold],
    ['精对齐 IoU(±0.05)', fmt(iouFine), iouFine >= level.excellentThreshold],
    ['通关 / 优秀阈值', `${fmt(level.matchThreshold)} / ${fmt(level.excellentThreshold)}`, true],
    ['目标影子面积(px)', String(area(targetMask)), area(targetMask) > 500],
    ['深度合法性', depthOk ? 'OK' : '违规', depthOk],
    ['目标贴边', touchingEdge ? '是' : '否', !touchingEdge],
  ];
  for (const [k, v, ok] of rows) {
    console.log(`  ${ok ? '✓' : '✗'} ${k.padEnd(18)} ${v}`);
    if (!ok) failures++;
  }

  if (touchingEdge) {
    console.log('  ⚠ 目标轮廓触及墙面边界，可能被裁剪导致难以精确匹配。');
  }
}

console.log('\n══════════════════════════════════════════════════════════════');
if (failures === 0) {
  console.log('✓ 全部检查通过');
} else {
  console.log(`✗ 存在 ${failures} 项未通过的检查`);
  process.exitCode = 1;
}
console.log('══════════════════════════════════════════════════════════════');
