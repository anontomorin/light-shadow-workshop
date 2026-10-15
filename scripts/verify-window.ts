/**
 * 窗棂纹样与多构件投影的验证脚本（Node 环境，不依赖浏览器 DOM/WebGL）。
 *
 * 覆盖开发文档 11.1 / 11.2 的检查项：
 *   1. 三个首批模板 + 回纹辅助模板能输出合法 strokes；
 *   2. 参数极限（0 / 负数 / NaN / 超大）被夹紧，不产生 NaN 或负宽度；
 *   3. 同一参数（含 seed）可复现；不同 seed 结果不同；
 *   4. 空白窗格投影后**中央空隙必须仍为 0**，且"整窗一次凸包"的错误实现
 *      会被同一条断言捕获（证明测试有效）；
 *   5. 步步锦投影的镂空率显著大于 0（空隙被真实保留）；
 *   6. 解析式投影与「遍历真实 Mesh + matrixWorld」的渲染路径逐点一致；
 *   7. 相邻杆件交叉处正常合并为实心；
 *   8. 深度非法时不产生 NaN，返回可读提示；
 *   9. 投影尺寸随窗格深度单调增大（点光源几何模型的正确行为）；
 *  10. 文化卡片引用的来源全部有效、都带 HTTPS 链接与核查日期；
 *  11. 全部十个关卡的目标轮廓投影与 IoU 链路不回归；
 *  12. 复合构件的每个零件自身都是凸的（凸包 == 原多边形）；
 *  13. 凹形（十字 / 五角星 / 圆环）与花窗构件的镂空必须被保留 ——
 *      同一断言会捕获"整窗一次凸包"的错误实现（证明测试有效）；
 *  14. 复合构件的「解析式投影」与「遍历真实网格 + matrixWorld」逐点一致。
 *
 * 运行：npm run verify:window
 */
import * as THREE from 'three';
import { LEVELS } from '../src/data/levels';
import {
  getObjectLocalVertices,
  getObjectPartGeometries,
  getShapeBaseSize,
  getShapeParts,
  SHAPE_LABEL,
} from '../src/scene/GeometryFactory';
import {
  MASK_H,
  MASK_W,
  WALL_MAX_X,
  WALL_MAX_Y,
  WALL_MIN_X,
  WALL_MIN_Y,
  WALL_Z,
  buildMatrix,
  clipPolygonToWall,
  convexHull,
  projectPoint,
  projectParts,
  type Point2,
} from '../src/projection/Projector';
import type {
  LevelDefinition,
  ShadowObjectDefinition,
  ShapeType,
  Transform3D,
} from '../src/gameplay/LevelData';
import { computeIoU } from '../src/projection/SilhouetteMatcher';
import { buildDocumentFromPattern, strokeStats } from '../src/window-builder/WindowDocument';
import {
  barLocalVertices,
  buildWindowGroup,
  createWindowMaterials,
  disposeWindowGroup,
  disposeWindowMaterials,
  extractBars,
} from '../src/window-builder/WindowGeometryBuilder';
import { boundsOfPolygons, projectWindowBars, projectWindowGroup } from '../src/projection/WindowProjector';
import { generatePatternStrokes, PATTERN_ORDER } from '../src/patterns/PatternRegistry';
import { clampPatternParameters, COMPLEXITY_LIMITS } from '../src/window-builder/GeometryLimits';
import { computeMetrics } from '../src/projection/ProjectionDiagnostics';
import {
  CULTURE_CARDS,
  CULTURE_SOURCES,
  DIGITAL_MODEL_NOTE,
  STYLE_MODEL_NOTE,
  USER_MODEL_NOTE,
} from '../src/culture/patternCatalog';
import type { PatternKind, PatternParameters, WindowDocument } from '../src/patterns/types';

// ─────────────────────────── 纯 CPU 光栅化（与 SilhouetteRasterizer 同语义） ───────────────────────────

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

/** 读取墙上某个世界坐标处的掩码值（取最近像素） */
function maskAt(mask: Uint8Array, p: Point2): number {
  const px = Math.floor(((p.x - WALL_MIN_X) / (WALL_MAX_X - WALL_MIN_X)) * MASK_W);
  const py = Math.floor(((WALL_MAX_Y - p.y) / (WALL_MAX_Y - WALL_MIN_Y)) * MASK_H);
  if (px < 0 || px >= MASK_W || py < 0 || py >= MASK_H) return 0;
  return mask[py * MASK_W + px];
}

function maskSum(mask: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) n += mask[i];
  return n;
}

/** 统计某个矩形区域内（mask 坐标）的填充像素 */
function maskSumInRect(mask: Uint8Array, x0: number, x1: number, y0: number, y1: number): number {
  let n = 0;
  for (let y = Math.max(0, y0); y <= Math.min(MASK_H - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(MASK_W - 1, x1); x++) {
      n += mask[y * MASK_W + x];
    }
  }
  return n;
}

// ─────────────────────────── 断言框架 ───────────────────────────

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${label}${detail ? ` · ${detail}` : ''}`);
  } else {
    failed++;
    failures.push(`${label}${detail ? ` · ${detail}` : ''}`);
    console.log(`  ✗ ${label}${detail ? ` · ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n━━━ ${title} ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/** 来源 id 集合，用于校验文化卡片的引用有效性 */
const SOURCE_IDS = new Set(CULTURE_SOURCES.map((s) => s.id));

// ─────────────────────────── 公共常量 ───────────────────────────

const LIGHT = { x: 0, y: 5.5, z: 14 };
const WINDOW_TRANSFORM = { x: 0, y: 5.2, z: 3.4, rotationX: 0, rotationY: 0, rotationZ: 0 };
const BASE_PARAMS: PatternParameters = clampPatternParameters({
  width: 3.2,
  height: 4.6,
  frameWidth: 0.2,
  barWidth: 0.09,
  rowCount: 4,
  columnCount: 4,
  seed: 20261015,
  density: 0.85,
});

function docOf(kind: PatternKind, extra: Partial<PatternParameters> = {}): WindowDocument {
  return buildDocumentFromPattern({
    patternId: kind,
    parameters: { ...BASE_PARAMS, ...extra },
    name: `测试-${kind}`,
  });
}

function matrixOf(t = WINDOW_TRANSFORM): THREE.Matrix4 {
  return buildMatrix(t);
}

/** 判断一个点是否落在窗框内（用于生成器合法性检查） */
function insideFrame(p: { x: number; y: number }, doc: WindowDocument, eps = 1e-6): boolean {
  return Math.abs(p.x) <= doc.width / 2 + eps && Math.abs(p.y) <= doc.height / 2 + eps;
}

console.log('══════════════════════════════════════════════════════════════');
console.log('  光影工坊 · 窗棂纹样与多构件投影验证');
console.log('══════════════════════════════════════════════════════════════');

// ═════════════════════ 1. 生成器 ═════════════════════

section('1. 纹样生成器');

const step = docOf('step-step-brocade');
const stepStats = strokeStats(step);
// 外框 4 + 横棂(row-1) + 竖棂(col-1)
const expectH = (BASE_PARAMS.rowCount ?? 1) - 1;
const expectV = (BASE_PARAMS.columnCount ?? 2) - 1;
const stepH = step.strokes.filter((s) => /^h\d+$/.test(s.id)).length;
const stepV = step.strokes.filter((s) => /^v\d+$/.test(s.id)).length;
check(
  '步步锦：横棂 / 竖棂数量与行列参数一致',
  stepH === expectH && stepV === expectV && stepStats.frame === 4,
  `横棂 ${stepH}=${expectH}，竖棂 ${stepV}=${expectV}，外框 ${stepStats.frame}`,
);
check(
  '步步锦：全部顶点落在窗框内',
  step.strokes.every((s) => s.points.every((p) => insideFrame(p, step))),
  `窗格 ${step.width}×${step.height}`,
);

const iceA = docOf('ice-crack-style');
const iceB = docOf('ice-crack-style');
const iceC = docOf('ice-crack-style', { seed: (BASE_PARAMS.seed ?? 1) + 1 });
const noZeroSeg = iceA.strokes.every((s) =>
  s.points.every(
    (p, i) => i === 0 || Math.abs(p.x - s.points[i - 1].x) > 1e-3 || Math.abs(p.y - s.points[i - 1].y) > 1e-3,
  ),
);
check('冰裂纹：不存在零长度线段', noZeroSeg);
check(
  '冰裂纹：全部顶点落在窗框内',
  iceA.strokes.every((s) => s.points.every((p) => insideFrame(p, iceA))),
);
check(
  '冰裂纹：相同 seed 输出完全一致',
  JSON.stringify(iceA.strokes) === JSON.stringify(iceB.strokes),
  `${iceA.strokes.length} 笔`,
);
check(
  '冰裂纹：不同 seed 输出不同（风格化构图生效）',
  JSON.stringify(iceA.strokes) !== JSON.stringify(iceC.strokes),
);

const liu = docOf('three-cross-six-bowl-diamond');
const liuGen = generatePatternStrokes('three-cross-six-bowl-diamond', BASE_PARAMS);
check(
  '三交六椀菱花：每条 stroke 至少 2 个点且相邻点不重合',
  liu.strokes.every(
    (s) =>
      s.points.length >= 2 &&
      s.points.every(
        (p, i) =>
          i === 0 || Math.abs(p.x - s.points[i - 1].x) > 1e-6 || Math.abs(p.y - s.points[i - 1].y) > 1e-6,
      ),
  ),
  `${liu.strokes.length} 笔`,
);
check(
  '三交六椀菱花：明确标注为「数字示意」',
  liuGen.modelNote.includes('数字示意'),
  liuGen.modelNote.slice(0, 24) + '…',
);
check(
  '三交六椀菱花：包含花心构件（六边形，6 段）',
  liu.strokes.some((s) => /^f\d+$/.test(s.id) && s.points.length === 6),
);

const huiGen = generatePatternStrokes('huiwen-border', { ...BASE_PARAMS, borderRepeat: 5 });
check(
  '回纹边饰：外框 4 + 每边 5 个单元 × 4 边',
  huiGen.strokes.length === 4 + 20,
  `${huiGen.strokes.length} 笔`,
);

// 参数夹紧
const wild = clampPatternParameters({
  width: -5,
  height: Number.NaN,
  frameWidth: 999,
  barWidth: -1,
  rowCount: 999,
  columnCount: -3,
  seed: Number.POSITIVE_INFINITY,
  density: 5,
});
check(
  '非法参数被夹紧为有限合法值',
  Number.isFinite(wild.width) &&
    wild.width > 0 &&
    wild.height > 0 &&
    wild.frameWidth > 0 &&
    wild.frameWidth * 2 < Math.min(wild.width, wild.height) &&
    wild.barWidth > 0 &&
    wild.rowCount! >= 1 &&
    wild.columnCount! >= 2 &&
    wild.density! <= 1,
  `w=${wild.width.toFixed(2)} h=${wild.height.toFixed(2)} f=${wild.frameWidth.toFixed(2)} bar=${wild.barWidth.toFixed(2)} rows=${wild.rowCount} cols=${wild.columnCount}`,
);

let allWithinLimits = true;
let maxSeg = 0;
for (const kind of PATTERN_ORDER) {
  const gen = generatePatternStrokes(kind, { ...BASE_PARAMS, borderEnabled: true, borderRepeat: 6 });
  const stats = strokeStats({ ...docOf(kind), strokes: gen.strokes });
  maxSeg = Math.max(maxSeg, stats.segments);
  if (stats.complexity.overLimit) allWithinLimits = false;
}
check('全部模板（含回纹边饰叠加）复杂度都在硬上限内', allWithinLimits, `最大线段数 ${maxSeg}/${COMPLEXITY_LIMITS.maxSegments}`);

// ═════════════════════ 2. 多构件投影与掩码 ═════════════════════

section('2. 多构件投影：空隙必须被保留');

// 空白窗格 = 只有外框的四根杆件，中央应完全镂空
const blank = docOf('blank');
const blankProj = projectWindowBars(extractBars(blank), matrixOf(), LIGHT);
const blankMask = rasterizeCPU(blankProj.polygons);
const centerPixel = maskAt(blankMask, { x: 0, y: 5.2 });
// 中央区域（避开窗框）必须全为 0
const cpx = Math.floor(((0 - WALL_MIN_X) / (WALL_MAX_X - WALL_MIN_X)) * MASK_W);
const cpy = Math.floor(((WALL_MAX_Y - 5.2) / (WALL_MAX_Y - WALL_MIN_Y)) * MASK_H);
const centerFill = maskSumInRect(blankMask, cpx - 10, cpx + 10, cpy - 10, cpy + 10);
check(
  '空白窗格（仅外框）投影后中央空隙全为 0',
  blankProj.polygons.length === 4 && centerFill === 0 && centerPixel === 0,
  `多边形 ${blankProj.polygons.length}，中央 21×21 像素填充 ${centerFill}`,
);

// 反例：把整扇窗的全部顶点汇总求一次凸包 —— 空隙会被填死
const allVertices: Point2[] = [];
for (const bar of extractBars(blank)) {
  for (const local of barLocalVertices(bar)) {
    const w = local.clone().applyMatrix4(matrixOf());
    const t = (LIGHT.z - 0) / (LIGHT.z - w.z);
    allVertices.push({ x: LIGHT.x + t * (w.x - LIGHT.x), y: LIGHT.y + t * (w.y - LIGHT.y) });
  }
}
const wrongHull = clipPolygonToWall(convexHull(allVertices));
const wrongMask = rasterizeCPU([wrongHull]);
const wrongCenterFill = maskSumInRect(wrongMask, cpx - 10, cpx + 10, cpy - 10, cpy + 10);
check(
  '错误实现（整窗一次凸包）确实会把中央空隙填满 —— 证明上一条断言有效',
  wrongCenterFill > 300,
  `中央 21×21 像素填充 ${wrongCenterFill}`,
);
check(
  '与错误实现相比，正确实现保留的镂空面积占比明显更高',
  maskSum(wrongMask) > maskSum(blankMask) * 2,
  `错误 ${maskSum(wrongMask)} px vs 正确 ${maskSum(blankMask)} px`,
);

// 步步锦：镂空率（包围盒内没有影子的比例）
const stepProj = projectWindowBars(extractBars(step), matrixOf(), LIGHT);
const stepMask = rasterizeCPU(stepProj.polygons);
const stepMetrics = computeMetrics(stepProj.polygons, stepMask);
check(
  '步步锦投影存在可量化的镂空（镂空率 > 25%）',
  stepMetrics.voidRatio > 0.25,
  `镂空率 ${(stepMetrics.voidRatio * 100).toFixed(1)}%，包围盒 ${stepMetrics.bounds?.width.toFixed(2)}×${stepMetrics.bounds?.height.toFixed(2)}`,
);

// 相邻杆件交叉处应合并为实心；格心（镂空）应保持空白
function firstCrossing(doc: WindowDocument): Point2 | null {
  const hs = doc.strokes.filter((s) => /^h\d+$/.test(s.id) && s.points.length === 2);
  const vs = doc.strokes.filter((s) => /^v\d+$/.test(s.id) && s.points.length === 2);
  for (const h of hs) {
    for (const v of vs) {
      const p = { x: v.points[0].x, y: h.points[0].y };
      if (insideFrame(p, doc)) return p;
    }
  }
  return null;
}

/**
 * 取第一个格心里"离所有杆件最远"的点作为镂空探针。
 *
 * 步步锦的阶梯线在格内归一化 u=1-d/cw 与 v=d/ch 处经过（d = 0.3·格短边），
 * 因此取 (0.35, 0.65) 可以保证离阶梯线与格边都足够远，
 * 探针不会因为"杆件本来就在附近"而误报。
 */
function cellProbePoint(doc: WindowDocument): Point2 {
  const hw = doc.width / 2 - doc.frameWidth;
  const hh = doc.height / 2 - doc.frameWidth;
  const cols = doc.parameters.columnCount ?? 2;
  const rows = doc.parameters.rowCount ?? 1;
  const cw = (2 * hw) / cols;
  const ch = (2 * hh) / rows;
  return { x: -hw + cw * 0.35, y: -hh + ch * 0.65 };
}

/** 窗格局部点 → 墙面点（先平移到世界坐标，再用窗格中心深度投影） */
function localToWall(p: Point2): Point2 {
  const wx = p.x + WINDOW_TRANSFORM.x;
  const wy = p.y + WINDOW_TRANSFORM.y;
  const t = (LIGHT.z - 0) / (LIGHT.z - WINDOW_TRANSFORM.z);
  return { x: LIGHT.x + t * (wx - LIGHT.x), y: LIGHT.y + t * (wy - LIGHT.y) };
}

/** 墙面点 → 掩码像素坐标 */
function wallToPixel(p: Point2): { px: number; py: number } {
  return {
    px: Math.round(((p.x - WALL_MIN_X) / (WALL_MAX_X - WALL_MIN_X)) * MASK_W),
    py: Math.round(((WALL_MAX_Y - p.y) / (WALL_MAX_Y - WALL_MIN_Y)) * MASK_H),
  };
}

/** 以墙面点为中心、半径 r（像素）的方块内填充像素数 */
function fillAround(mask: Uint8Array, p: Point2, r: number): number {
  const { px, py } = wallToPixel(p);
  return maskSumInRect(mask, px - r, px + r, py - r, py + r);
}

const cross = firstCrossing(step);
const crossFill = cross ? fillAround(stepMask, localToWall(cross), 3) : 0;
check(
  '相邻杆件交叉位置合并为实心（无接缝空隙）',
  !!cross && crossFill > 0,
  cross ? `交叉点 (${cross.x.toFixed(2)}, ${cross.y.toFixed(2)}) → 7×7 像素填充 ${crossFill}` : '未找到交叉点',
);

const cell = cellProbePoint(step);
const cellFill = fillAround(stepMask, localToWall(cell), 2);
check(
  '格心位置保持镂空（影子没有被"整窗凸包"填死）',
  cellFill === 0,
  `格心探针 (${cell.x.toFixed(2)}, ${cell.y.toFixed(2)}) → 5×5 像素填充 ${cellFill}`,
);

// 解析式 vs Mesh + matrixWorld
const materials = createWindowMaterials();
const built = buildWindowGroup(step, materials);
const root = new THREE.Group();
root.matrix.copy(matrixOf());
root.matrixAutoUpdate = false;
root.add(built.group);
root.updateMatrixWorld(true);

const meshPath = projectWindowGroup(built.group, LIGHT);
const analyticPath = projectWindowBars(extractBars(step), built.group.matrixWorld, LIGHT);
check(
  '解析式投影与「遍历 Mesh + matrixWorld」路径多边形数量一致',
  meshPath.polygons.length === analyticPath.polygons.length,
  `${meshPath.polygons.length} vs ${analyticPath.polygons.length}`,
);

const canon = (polys: Point2[][]) =>
  polys.map((poly) =>
    poly
      .map((p) => `${p.x.toFixed(9)},${p.y.toFixed(9)}`)
      .sort()
      .join('|'),
  );
const sameGeom = JSON.stringify(canon(meshPath.polygons)) === JSON.stringify(canon(analyticPath.polygons));
check('两条路径的投影轮廓逐点一致（显示与判定不可能不一致）', sameGeom);

// ═════════════════════ 4. 复合构件与凹形镂空 ═════════════════════

/**
 * 第 7–10 关的题目取自经典花窗，物体是"棂条拼成的复合构件"；自由实验室还新增了
 * 十字 / 五角星 / 圆环等凹形。这类几何**必须逐零件求凸包再取并集**，
 * 否则格眼与中空会被整块凸包填死 —— 一扇花窗会变成一块实心窗板。
 *
 * 本节既断言"正确实现保留了镂空"，也用同一条断言捕获"整块凸包"的错误实现，
 * 因此这些检查是**有判别力**的（错误实现必然失败），而不是同义反复。
 */
section('3. 复合构件与凹形镂空');

/** 多边形面积（鞋带公式） */
function polygonArea(poly: Point2[]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  }
  return Math.abs(a / 2);
}

const ALL_SHAPES: ShapeType[] = [
  'triangle',
  'square',
  'rectangle',
  'circle',
  'hexagon',
  'diamond',
  'pentagon',
  'octagon',
  'trapezoid',
  'semicircle',
  'slat',
  'cross',
  'star',
  'ring',
];

const nonConvex = ALL_SHAPES.filter((t) =>
  getShapeParts(t).some((p) => Math.abs(polygonArea(convexHull(p)) - polygonArea(p)) > 1e-9),
);
check(
  '每个零件的轮廓都是凸多边形（凸包等于自身，"逐零件凸包"因此精确）',
  nonConvex.length === 0,
  nonConvex.length ? `非凸：${nonConvex.join(' / ')}` : `${ALL_SHAPES.length} 种形状全部通过`,
);

const MULTI_PART: ShapeType[] = ['cross', 'star', 'ring'];
const MULTI_PART_OWN: Record<string, number> = { cross: 3, star: 6, ring: 18 };
const decompositionOk =
  ALL_SHAPES.every(
    (t) => getShapeParts(t).length > (MULTI_PART.includes(t) ? 1 : 0),
  ) && MULTI_PART.every((t) => getShapeParts(t).length === MULTI_PART_OWN[t]);
check(
  '凹形被拆成多个凸零件，其余形状保持单零件',
  decompositionOk,
  ALL_SHAPES.map((t) => `${SHAPE_LABEL[t]}=${getShapeParts(t).length}`).join(' '),
);

/**
 * 构件用 w / h 标尺寸，换算基准必须与真实轮廓一致 ——
 * 否则改了基准轮廓却忘了基准尺寸，所有构件都会被悄悄拉伸。
 * 回转对称形状要求基准 = 外接圆直径且不小于包围盒（写 w = h 即等比）；
 * 其余形状要求基准 = 包围盒。
 */
const CIRCUMSCRIBED = new Set<ShapeType>([
  'triangle',
  'circle',
  'hexagon',
  'pentagon',
  'octagon',
  'star',
  'ring',
]);
const baseSizeBad: string[] = [];
for (const t of ALL_SHAPES) {
  const base = getShapeBaseSize(t);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (const ring of getShapeParts(t)) {
    for (const v of ring) {
      minX = Math.min(minX, v.x);
      maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      maxR = Math.max(maxR, Math.hypot(v.x, v.y));
    }
  }
  const bbox = { w: maxX - minX, h: maxY - minY };
  const ok = CIRCUMSCRIBED.has(t)
    ? Math.abs(base.w - maxR * 2) < 1e-9 &&
      Math.abs(base.h - maxR * 2) < 1e-9 &&
      base.w >= bbox.w - 1e-9 &&
      base.h >= bbox.h - 1e-9
    : Math.abs(base.w - bbox.w) < 1e-9 && Math.abs(base.h - bbox.h) < 1e-9;
  if (!ok) baseSizeBad.push(`${SHAPE_LABEL[t]}(基准 ${base.w.toFixed(3)}×${base.h.toFixed(3)}, 实际 ${bbox.w.toFixed(3)}×${bbox.h.toFixed(3)})`);
}
check(
  '形状基准尺寸与真实轮廓一致（w / h 换算不会被悄悄拉伸）',
  baseSizeBad.length === 0,
  baseSizeBad.length ? baseSizeBad.join(' / ') : `${ALL_SHAPES.length} 种形状全部一致`,
);

/** 把一扇花窗/凹形投影成掩码：naive=true 时故意把整组顶点摊平后只求一次凸包 */
function shapeMask(parts: THREE.Vector3[][], naive: boolean, scale: number): Uint8Array {
  const polys: Point2[][] = [];
  for (const hull of projectParts(naive ? [parts.flat()] : parts, T_SHAPE, LIGHT, scale)) {
    const c = clipPolygonToWall(hull);
    if (c.length >= 3) polys.push(c);
  }
  return rasterizeCPU(polys);
}

const T_SHAPE: Transform3D = { x: 0, y: 5.5, z: 4, rotationX: 0, rotationY: 0, rotationZ: 0 };

for (const shape of ['cross', 'star', 'ring'] as ShapeType[]) {
  const def: ShadowObjectDefinition = {
    id: 'probe',
    name: SHAPE_LABEL[shape],
    shape,
    color: '#ffffff',
    initial: T_SHAPE,
    target: T_SHAPE,
    scale: 2.2,
  };
  const parts = getObjectLocalVertices(def);
  const ok = maskSum(shapeMask(parts, false, 2.2));
  const naive = maskSum(shapeMask(parts, true, 2.2));
  check(
    `${SHAPE_LABEL[shape]}：逐零件投影保留镂空，整块凸包会把镂空填死`,
    naive - ok > 200,
    `正确 ${ok}px vs 整块凸包 ${naive}px（差 ${naive - ok}px，即被填死的面积）`,
  );
}

/** 用同一套投影规则算某一关的掩码；naive=true 时按物体整体求凸包 */
function levelMask(level: LevelDefinition, naive: boolean): Uint8Array {
  const polys: Point2[][] = [];
  level.objects.forEach((obj) => {
    const parts = getObjectLocalVertices(obj);
    for (const hull of projectParts(
      naive ? [parts.flat()] : parts,
      obj.target,
      level.light.target,
      obj.scale ?? 1,
    )) {
      const c = clipPolygonToWall(hull);
      if (c.length >= 3) polys.push(c);
    }
  });
  return rasterizeCPU(polys);
}

const latticeLevels = LEVELS.filter((l) => l.objects.some((o) => (o.parts?.length ?? 0) > 1));
check(
  '存在由棂条构件构成的经典花窗关卡',
  latticeLevels.length >= 4,
  `${latticeLevels.length} 关：${latticeLevels.map((l) => `第${l.id}关`).join(' ')}`,
);

for (const level of latticeLevels) {
  const ok = maskSum(levelMask(level, false));
  const naive = maskSum(levelMask(level, true));
  const holes = countHoles(levelMask(level, false));
  check(
    `第 ${level.id} 关《${level.title}》：格眼被如实保留`,
    naive - ok > 150 && holes > 0,
    `正确 ${ok}px vs 整块凸包 ${naive}px；影子里有 ${holes} 处独立镂空`,
  );
}

/** 统计掩码里的"洞"（背景连通域中被影子完全包围的那些），用于证明格眼真的存在 */
function countHoles(mask: Uint8Array): number {
  const seen = new Uint8Array(mask.length);
  const stack: number[] = [];
  // 先从边界把所有"外部的背景"泛洪掉
  for (let px = 0; px < MASK_W; px++) {
    for (const py of [0, MASK_H - 1]) {
      const i = py * MASK_W + px;
      if (!mask[i] && !seen[i]) {
        seen[i] = 1;
        stack.push(i);
      }
    }
  }
  for (let py = 0; py < MASK_H; py++) {
    for (const px of [0, MASK_W - 1]) {
      const i = py * MASK_W + px;
      if (!mask[i] && !seen[i]) {
        seen[i] = 1;
        stack.push(i);
      }
    }
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const px = i % MASK_W;
    const py = (i - px) / MASK_W;
    const push = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= MASK_W || ny >= MASK_H) return;
      const j = ny * MASK_W + nx;
      if (mask[j] || seen[j]) return;
      seen[j] = 1;
      stack.push(j);
    };
    push(px - 1, py);
    push(px + 1, py);
    push(px, py - 1);
    push(px, py + 1);
  }
  // 剩下未被标记的背景像素就是洞；按 4 连通把它们数成若干个
  let holes = 0;
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || seen[i]) continue;
    holes++;
    const stack2: number[] = [i];
    seen[i] = 1;
    while (stack2.length) {
      const k = stack2.pop() as number;
      const px = k % MASK_W;
      const py = (k - px) / MASK_W;
      const push = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= MASK_W || ny >= MASK_H) return;
        const j = ny * MASK_W + nx;
        if (mask[j] || seen[j]) return;
        seen[j] = 1;
        stack2.push(j);
      };
      push(px - 1, py);
      push(px + 1, py);
      push(px, py - 1);
      push(px, py + 1);
    }
  }
  return holes;
}

// 解析式 vs 「真实网格 + matrixWorld」（复合构件）
//
// 这里刻意**比较投影点集本身**，而不是比较凸包顶点：圆环这类很薄的零件，
// 投影后常有三个点近乎共线，1e-7 的浮点差异就会让"谁在凸包上"翻转，
// 拿凸包顶点做逐点比较会得到假失败。点集一致 + 光栅化结果一致，
// 才是"看到的与判定的不可能不一致"的正确表述。
function clampDeg(deg: number): number {
  return THREE.MathUtils.degToRad(deg);
}

/** 解析式路径：局部顶点经同一套矩阵摆到世界后逐点投影 */
function analyticProjectedGroups(def: ShadowObjectDefinition): Point2[][] {
  const mat = buildMatrix(def.target, def.scale ?? 1);
  const v = new THREE.Vector3();
  return getObjectLocalVertices(def).map((part) =>
    part
      .map((p) => projectPoint(LIGHT, v.set(p.x, p.y, p.z).applyMatrix4(mat), WALL_Z))
      .filter((q): q is Point2 => !!q),
  );
}

/** 渲染路径：遍历真实 Mesh 的 position 属性，经 matrixWorld 摆到世界后逐点投影 */
function meshProjectedGroups(def: ShadowObjectDefinition): Point2[][] {
  const scale = def.scale ?? 1;
  const t = def.target;
  const root = new THREE.Group();
  const materials: THREE.Material[] = [];
  for (const p of getObjectPartGeometries(def)) {
    const material = new THREE.MeshBasicMaterial();
    materials.push(material);
    const mesh = new THREE.Mesh(p.geometry, material);
    mesh.position.set(p.dx, p.dy, 0);
    mesh.rotation.z = clampDeg(p.rot);
    mesh.scale.set(scale * p.sx, scale * p.sy, scale);
    root.add(mesh);
  }
  root.position.set(t.x, t.y, t.z);
  root.rotation.set(clampDeg(t.rotationX), clampDeg(t.rotationY), clampDeg(t.rotationZ));
  root.updateMatrixWorld(true);

  const out: Point2[][] = [];
  const v = new THREE.Vector3();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const pos = mesh.geometry.getAttribute('position');
    const pts: Point2[] = [];
    for (let i = 0; i < pos.count; i++) {
      const q = projectPoint(LIGHT, v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld), WALL_Z);
      if (q) pts.push(q);
    }
    out.push(pts);
  });
  materials.forEach((m) => m.dispose());
  return out;
}

/**
 * 按容差去重。渲染路径的顶点来自挤出几何体（端面三角化 + 侧壁），
 * 同一个角点会被重复输出很多次；解析式只给一份。
 * 去重后再比点集，"重复顶点数不同"就不会被误判成不一致。
 */
function dedupePoints(pts: Point2[], eps = 1e-5): Point2[] {
  const out: Point2[] = [];
  for (const p of pts) {
    if (!out.some((q) => Math.abs(q.x - p.x) <= eps && Math.abs(q.y - p.y) <= eps)) out.push(p);
  }
  return out;
}

/** 两组点集在 eps 容差内一一对应（顺序无关） */
function pointSetsMatch(a: Point2[], b: Point2[], eps = 1e-5): boolean {
  if (a.length !== b.length) return false;
  const used = new Array<boolean>(b.length).fill(false);
  for (const p of a) {
    let hit = -1;
    for (let i = 0; i < b.length; i++) {
      if (used[i]) continue;
      if (Math.abs(b[i].x - p.x) <= eps && Math.abs(b[i].y - p.y) <= eps) {
        hit = i;
        break;
      }
    }
    if (hit < 0) return false;
    used[hit] = true;
  }
  return true;
}

/** 把逐组投影点集变成墙面多边形（逐组凸包 + 裁剪） */
function groupsToPolygons(groups: Point2[][]): Point2[][] {
  const out: Point2[][] = [];
  for (const g of groups) {
    if (g.length < 3) continue;
    const hull = convexHull(g);
    if (hull.length < 3) continue;
    const clipped = clipPolygonToWall(hull);
    if (clipped.length >= 3) out.push(clipped);
  }
  return out;
}

let verticesConsistent = true;
let masksConsistent = true;
let meshPartTotal = 0;
let partTotal = 0;
const inconsistent: string[] = [];

for (const level of latticeLevels) {
  const analyticPolys: Point2[][] = [];
  const meshPolys: Point2[][] = [];
  for (const obj of level.objects) {
    const a = analyticProjectedGroups(obj);
    const b = meshProjectedGroups(obj);
    meshPartTotal += b.length;
    partTotal += a.length;
    if (a.length !== b.length) {
      verticesConsistent = false;
      inconsistent.push(`${obj.id} 零件数 ${a.length} vs ${b.length}`);
      continue;
    }
    for (let i = 0; i < a.length; i++) {
      if (!pointSetsMatch(dedupePoints(a[i]), dedupePoints(b[i]))) {
        verticesConsistent = false;
        inconsistent.push(`${obj.id} 零件 ${i}`);
      }
    }
    analyticPolys.push(...groupsToPolygons(a));
    meshPolys.push(...groupsToPolygons(b));
  }
  const iou = computeIoU(rasterizeCPU(analyticPolys), rasterizeCPU(meshPolys));
  if (iou < 0.9995) {
    masksConsistent = false;
    inconsistent.push(`第 ${level.id} 关光影 IoU=${iou.toFixed(5)}`);
  }
}

check(
  '复合构件两侧同步：解析式顶点与「真实网格 + matrixWorld」逐点一致',
  verticesConsistent,
  `${latticeLevels.length} 关 / ${partTotal} 个零件的投影点集${inconsistent.length ? ` · 不一致：${inconsistent.join('，')}` : ''}`,
);
check(
  '两条路径光栅化出的墙面影子一致（显示与判定不可能不一致）',
  masksConsistent,
  `${latticeLevels.length} 关全部 IoU ≥ 0.9995`,
);

const mb = boundsOfPolygons(meshPath.polygons);
const ab = boundsOfPolygons(analyticPath.polygons);
check(
  '两条路径的投影包围盒一致',
  !!mb && !!ab && Math.abs(mb.width - ab.width) < 1e-9 && Math.abs(mb.height - ab.height) < 1e-9,
  mb ? `${mb.width.toFixed(6)}×${mb.height.toFixed(6)}` : 'null',
);

disposeWindowGroup(built.group);
disposeWindowMaterials(materials);

// 非法深度：不产生 NaN，返回可读提示
const behind = projectWindowBars(extractBars(step), matrixOf({ ...WINDOW_TRANSFORM, z: LIGHT.z }), LIGHT);
const noNaN = behind.polygons.every((poly) => poly.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
check(
  '窗格与光源同深度：不产生 NaN，返回可读提示',
  noNaN && behind.partial && behind.note.length > 0,
  behind.note.slice(0, 30),
);

// 单调性：窗格越靠近光源，投影越大
const widths = [2.0, 4.0, 6.0].map((z) => {
  const pr = projectWindowBars(extractBars(step), matrixOf({ ...WINDOW_TRANSFORM, z }), LIGHT);
  return boundsOfPolygons(pr.polygons)?.width ?? 0;
});
check(
  '点光源几何模型：窗格越靠近光源，投影越大（单调）',
  widths[2] > widths[1] && widths[1] > widths[0],
  widths.map((w) => w.toFixed(2)).join(' < '),
);

// 越界裁剪
const far = projectWindowBars(
  extractBars(step),
  matrixOf({ ...WINDOW_TRANSFORM, x: 7.0, y: 5.2, z: 3.4 }),
  LIGHT,
);
check(
  '投影超出墙面时按墙面矩形裁剪，不产生越界点',
  far.polygons.length > 0 &&
    far.polygons.every((poly) =>
      poly.every(
        (p) =>
          p.x >= WALL_MIN_X - 1e-6 &&
          p.x <= WALL_MAX_X + 1e-6 &&
          p.y >= WALL_MIN_Y - 1e-6 &&
          p.y <= WALL_MAX_Y + 1e-6,
      ),
    ),
  `裁剪后仍有 ${far.polygons.length} 个多边形`,
);

// ═════════════════════ 4. 全部关卡投影链路回归 ═════════════════════

section('4. 全部十个关卡的投影链路回归');

for (const level of LEVELS) {
  const polys: Point2[][] = [];
  level.objects.forEach((obj, i) => {
    for (const hull of projectParts(
      getObjectLocalVertices(obj),
      level.objects[i].target,
      level.light.target,
      obj.scale ?? 1,
    )) {
      const clipped = clipPolygonToWall(hull);
      if (clipped.length >= 3) polys.push(clipped);
    }
  });
  const mask = rasterizeCPU(polys);
  const iou = computeIoU(mask, mask);
  const area = maskSum(mask);
  check(
    `第 ${level.id} 关「${level.title}」目标轮廓投影正常`,
    iou === 1 && area > 500,
    `IoU=${iou.toFixed(3)}，面积=${area}px，多边形=${polys.length}`,
  );
}

// ═════════════════════ 4. 文化数据完整性 ═════════════════════

section('5. 文化数据完整性（可追溯性）');

const cardSrcOk = CULTURE_CARDS.every((c) => c.sourceIds.every((id) => SOURCE_IDS.has(id)));
check(
  '每张文化卡片引用的来源都能在来源表中找到',
  cardSrcOk,
  `卡片 ${CULTURE_CARDS.length} 张，来源 ${CULTURE_SOURCES.length} 条`,
);

const everyCardHasSource = CULTURE_CARDS.every((c) => c.sourceIds.length >= 1);
check('每张文化卡片至少引用 1 条来源', everyCardHasSource);

const urlOk = CULTURE_SOURCES.every((s) => /^https:\/\/\S+$/.test(s.url) && s.publisher.length > 0);
check('每条来源都有机构名与 HTTPS 链接', urlOk);

const dateOk = CULTURE_SOURCES.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt) && !Number.isNaN(Date.parse(s.accessedAt)));
check(
  '每条来源都记录了核查日期',
  dateOk,
  `核查日期 ${CULTURE_SOURCES[0]?.accessedAt}`,
);

/** 首批三个「名称型」模板都必须有文化卡片（空白窗格与回纹是辅助模块，同样要有） */
const missingCard = PATTERN_ORDER.filter((k) => !CULTURE_CARDS.some((c) => c.patternId === k));
check(
  '全部纹样模板都有对应的文化卡片',
  missingCard.length === 0,
  missingCard.length ? `缺少 ${missingCard.join(', ')}` : `${PATTERN_ORDER.length} 个模板全部有卡片`,
);

const notesOk = [DIGITAL_MODEL_NOTE, STYLE_MODEL_NOTE, USER_MODEL_NOTE].every((n) => n.length > 20);
check('三类声明文案齐备（数字示意 / 风格化创作 / 用户创作）', notesOk);
check(
  '三交六椀菱花与冰裂纹分别标注「数字示意」「风格化」',
  DIGITAL_MODEL_NOTE.includes('数字示意') && STYLE_MODEL_NOTE.includes('风格化'),
);

// ═════════════════════ 汇总 ═════════════════════

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`  通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) {
  console.log('  未通过：');
  for (const f of failures) console.log(`    ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log('  ✓ 全部检查通过');
}
console.log('══════════════════════════════════════════════════════════════');
