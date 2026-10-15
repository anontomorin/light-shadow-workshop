import * as THREE from 'three';
import type { ShadowObjectDefinition, ShapePart, ShapeType } from '../gameplay/LevelData';

/**
 * 几何工厂：把「形状 / 复合构件」翻译成两组等价的数据 ——
 *   1. 局部轮廓点（给投影与 IoU 判定用，见 `getObjectLocalVertices`）
 *   2. 挤出几何体（给渲染用，见 `getObjectPartGeometries`）
 *
 * ## 为什么是"零件"而不是"一个轮廓"
 *
 * 最早的实现是「一个物体 → 一个轮廓 → 投影后取一次凸包」。这对凸形状没问题，
 * 但本轮新增了十字、五角星、圆环这类**凹形**，以及由棂条拼成的**花窗构件**：
 * 若仍然对整体求一次凸包，凹口与中空会被填死——十字会变成一个方板，
 * 一扇花窗会变成一块实心窗板，镂空全丢。
 *
 * 因此这里把每个形状拆成**若干凸零件**：
 *   · 凸形（三角/方/圆/五边/八边/梯形/扇形/菱形/棂条）→ 1 个零件；
 *   · 十字 → 3 个矩形；五角星 → 中心五边形 + 5 个三角；圆环 → 18 个环扇。
 * 投影时对**每个零件单独求凸包**，再把所有多边形交给
 * `SilhouetteRasterizer.rasterize()` 做并集；渲染同理，用一组零件网格拼出物体，
 * 再用模板缓冲并集铺色（见 ProjectionRenderer）。
 * 于是"零件之间没有覆盖的地方"恒为镂空，凹形与花窗的空隙都被如实保留。
 *
 * ## 一致性约定
 *
 * 零件的二维轮廓被"挤出"成薄片：先在 XY 平面缩放到目标宽高 w × h、
 * 绕 Z 旋转 rot、平移到 (dx, dy)，再由物体变换摆到世界里。
 * 渲染用的 Mesh 走的是完全相同的三步（`mesh.scale` / `mesh.rotation.z` /
 * `mesh.position`），投影用的顶点也是解析式算出来的同一组数，
 * 因此"看到的"和"判定的"必然一致。
 */

/** 薄片厚度：物体以"薄片"形式呈现，投影时前后两层顶点都会被计算 */
export const PLATE_THICKNESS = 0.3;

/** 圆形用 48 个顶点近似 */
const CIRCLE_SEGMENTS = 48;
/** 圆环拆成 18 个环扇（凸四边形），18 段内接多边形的内切损失 < 0.5% */
const RING_SEGMENTS = 18;

type Pt = [number, number];

/** 极坐标取点（角度制） */
function polar(deg: number, r: number): Pt {
  const a = (deg * Math.PI) / 180;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

/** 正多边形：从 startDeg 开始均匀取 n 个顶点 */
function regular(n: number, r: number, startDeg: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) out.push(polar(startDeg + (i * 360) / n, r));
  return out;
}

/** 圆弧采样：从 a0 到 a1（角度制），含两端点 */
function arc(r: number, a0: number, a1: number, segs: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) out.push(polar(a0 + ((a1 - a0) * i) / segs, r));
  return out;
}

/** 轴对齐矩形（可指定中心与半宽半高） */
function rect(halfW: number, halfH: number, cx = 0, cy = 0): Pt[] {
  return [
    [cx - halfW, cy - halfH],
    [cx + halfW, cy - halfH],
    [cx + halfW, cy + halfH],
    [cx - halfW, cy + halfH],
  ];
}

/**
 * 各形状的"凸零件"基准轮廓（未缩放，物体局部坐标）。
 *
 * 这里的每个数组元素都必须是**凸多边形** —— 这是整套镂空逻辑成立的前提。
 */
function buildBaseParts(type: ShapeType): Pt[][] {
  switch (type) {
    case 'triangle':
      return [regular(3, 0.95, 90)];
    case 'square':
      return [rect(0.8, 0.8)];
    case 'rectangle':
      return [rect(1.35, 0.42)];
    case 'circle':
      return [arc(0.85, 0, 360, CIRCLE_SEGMENTS).slice(0, CIRCLE_SEGMENTS)];
    case 'hexagon':
      return [regular(6, 0.9, 0)];
    case 'diamond':
      return [
        [
          [0, 0.6],
          [-1.15, 0],
          [0, -0.6],
          [1.15, 0],
        ],
      ];
    case 'pentagon':
      return [regular(5, 0.95, 90)];
    case 'octagon':
      return [regular(8, 0.95, 22.5)];
    case 'trapezoid':
      return [
        [
          [-1.1, -0.72],
          [1.1, -0.72],
          [0.6, 0.72],
          [-0.6, 0.72],
        ],
      ];
    case 'semicircle':
      // 上半圆 + 底边（闭合边就是直径）
      return [arc(0.95, 0, 180, CIRCLE_SEGMENTS / 2)];
    case 'slat':
      // 1 × 1 基准方条：sx / sy 直接就是实际长宽，便于手工拼装窗棂
      return [rect(0.5, 0.5)];
    case 'cross':
      // 竖臂 + 左右两条横臂（三段互不重叠，拼接成一个完整的十字）
      return [rect(0.3, 0.95), rect(0.325, 0.3, -0.625), rect(0.325, 0.3, 0.625)];
    case 'star': {
      // 中心正五边形（内顶点）+ 5 个外尖三角，两者拼合**恰好**是五角星
      const rIn = 0.42;
      const rOut = 1.0;
      const inner: Pt[] = [];
      for (let k = 0; k < 5; k++) inner.push(polar(54 + k * 72, rIn));
      const parts: Pt[][] = [inner];
      for (let k = 0; k < 5; k++) {
        const tip = polar(90 + k * 72, rOut);
        const a = inner[k];
        const b = inner[(k + 1) % 5];
        parts.push([a, tip, b]);
      }
      return parts;
    }
    case 'ring': {
      const rOut = 0.95;
      const rIn = 0.6;
      const parts: Pt[][] = [];
      for (let j = 0; j < RING_SEGMENTS; j++) {
        const a0 = (j * 360) / RING_SEGMENTS;
        const a1 = ((j + 1) * 360) / RING_SEGMENTS;
        parts.push([polar(a0, rOut), polar(a1, rOut), polar(a1, rIn), polar(a0, rIn)]);
      }
      return parts;
    }
  }
}

const basePartsCache = new Map<ShapeType, THREE.Vector2[][]>();
const baseExtentCache = new Map<ShapeType, { w: number; h: number }>();

/** 形状的凸零件基准轮廓（缓存；返回只读副本语义，调用方不要原地改） */
export function getShapeParts(type: ShapeType): THREE.Vector2[][] {
  const cached = basePartsCache.get(type);
  if (cached) return cached;
  const pts = buildBaseParts(type).map((ring) => ring.map(([x, y]) => new THREE.Vector2(x, y)));
  basePartsCache.set(type, pts);
  return pts;
}

/**
 * 哪些形状的"基准尺寸"取**外接圆直径**而不是轮廓包围盒。
 *
 * 这些形状都是回转对称的：正多边形/五角星的顶点方向不落在 x、y 轴上，
 * 包围盒会随取点角度变小一点（例如正六边形包围盒是 1.8 × 1.56），
 * 若拿它当基准，作者写 `w = h` 就会得到被拉扁的形状。
 * 取外接圆直径后，`w = h` 恒等于"等比缩放的正多边形"，语义清晰。
 *
 * 其余形状（方、长方、菱、梯形、半圆、棂条、十字）本身就有明确的长宽比，
 * 直接用包围盒作为基准。
 */
const CIRCUMSCRIBED_BASE = new Set<ShapeType>([
  'triangle',
  'circle',
  'hexagon',
  'pentagon',
  'octagon',
  'star',
  'ring',
]);

/**
 * 形状基准尺寸。零件作者写 `w` / `h` 时以此换算缩放系数：
 * 回转对称形状为外接圆直径，其余为轮廓包围盒。
 */
export function getShapeBaseSize(type: ShapeType): { w: number; h: number } {
  const cached = baseExtentCache.get(type);
  if (cached) return cached;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let maxR = 0;
  for (const ring of getShapeParts(type)) {
    for (const v of ring) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      maxR = Math.max(maxR, Math.hypot(v.x, v.y));
    }
  }
  const size = CIRCUMSCRIBED_BASE.has(type)
    ? { w: maxR * 2, h: maxR * 2 }
    : { w: maxX - minX, h: maxY - minY };
  baseExtentCache.set(type, size);
  return size;
}

/** 一个构件零件的变换参数（缺省值补齐，w / h 换算为缩放系数） */
interface ResolvedPart {
  shape: ShapeType;
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
}

function resolvePart(part: ShapePart): ResolvedPart {
  const base = getShapeBaseSize(part.shape);
  // 只给一轴时另一轴等比跟随，避免形状被意外拉扁
  let sx = 1;
  let sy = 1;
  if (part.w !== undefined || part.h !== undefined) {
    if (part.w !== undefined && part.h !== undefined) {
      sx = part.w / base.w;
      sy = part.h / base.h;
    } else if (part.w !== undefined) {
      sx = part.w / base.w;
      sy = sx;
    } else {
      sy = (part.h as number) / base.h;
      sx = sy;
    }
  }
  return {
    shape: part.shape,
    dx: part.dx ?? 0,
    dy: part.dy ?? 0,
    rot: part.rot ?? 0,
    sx,
    sy,
  };
}

/** 把一组零件展开成"所有凸零件在物体局部坐标下的二维轮廓" */
export function getObjectOutlineParts(def: ShadowObjectDefinition): THREE.Vector2[][] {
  const raw: ShapePart[] = def.parts?.length
    ? def.parts
    : [{ shape: def.shape }];
  const cos = (deg: number) => Math.cos((deg * Math.PI) / 180);
  const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);
  const out: THREE.Vector2[][] = [];
  for (const p of raw) {
    const rp = resolvePart(p);
    const c = cos(rp.rot);
    const s = sin(rp.rot);
    for (const ring of getShapeParts(rp.shape)) {
      out.push(
        ring.map((v) => {
          const x = v.x * rp.sx;
          const y = v.y * rp.sy;
          return new THREE.Vector2(rp.dx + x * c - y * s, rp.dy + x * s + y * c);
        }),
      );
    }
  }
  return out;
}

/**
 * 供投影计算使用的局部顶点：**按零件分组**，每个零件都是前后两层（含厚度）。
 *
 * 返回三维数组而不是单层数组，是为了让调用方对每个零件单独求凸包；
 * 一旦摊平成一个数组再求凸包，凹形与花窗的镂空就会消失。
 */
export function getObjectLocalVertices(def: ShadowObjectDefinition): THREE.Vector3[][] {
  const half = PLATE_THICKNESS / 2;
  return getObjectOutlineParts(def).map((ring) => {
    const verts: THREE.Vector3[] = [];
    for (const p of ring) verts.push(new THREE.Vector3(p.x, p.y, -half));
    for (const p of ring) verts.push(new THREE.Vector3(p.x, p.y, half));
    return verts;
  });
}

/** 一个零件在物体局部坐标下的摆放方式（用于组装渲染网格） */
export interface PartPlacement {
  geometry: THREE.ExtrudeGeometry;
  dx: number;
  dy: number;
  rot: number;
  sx: number;
  sy: number;
}

const partGeometryCache = new Map<string, THREE.ExtrudeGeometry>();

function partGeometryOf(type: ShapeType, index: number): THREE.ExtrudeGeometry {
  const key = `${type}#${index}`;
  const cached = partGeometryCache.get(key);
  if (cached) return cached;
  const ring = getShapeParts(type)[index];
  const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: PLATE_THICKNESS,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -PLATE_THICKNESS / 2);
  geo.computeVertexNormals();
  partGeometryCache.set(key, geo);
  return geo;
}

/**
 * 物体渲染所需的零件几何体清单。
 * 单零件形状返回 1 项（与旧实现等价）；十字 3 项、五角星 6 项、圆环 18 项。
 */
export function getObjectPartGeometries(def: ShadowObjectDefinition): PartPlacement[] {
  const raw: ShapePart[] = def.parts?.length ? def.parts : [{ shape: def.shape }];
  const out: PartPlacement[] = [];
  for (const p of raw) {
    const rp = resolvePart(p);
    const parts = getShapeParts(rp.shape);
    for (let i = 0; i < parts.length; i++) {
      out.push({
        geometry: partGeometryOf(rp.shape, i),
        dx: rp.dx,
        dy: rp.dy,
        rot: rp.rot,
        sx: rp.sx,
        sy: rp.sy,
      });
    }
  }
  return out;
}

/** 形状的中文名 */
export const SHAPE_LABEL: Record<ShapeType, string> = {
  triangle: '三角形',
  square: '正方形',
  rectangle: '长方形',
  circle: '圆形',
  hexagon: '六边形',
  diamond: '菱形',
  pentagon: '五边形',
  octagon: '八边形',
  trapezoid: '梯形',
  semicircle: '半圆',
  cross: '十字形',
  star: '五角星',
  ring: '圆环',
  slat: '棂条',
};

/** 释放全部缓存的几何体资源 */
export function disposeGeometryCache(): void {
  partGeometryCache.forEach((g) => g.dispose());
  partGeometryCache.clear();
  basePartsCache.clear();
  baseExtentCache.clear();
}
