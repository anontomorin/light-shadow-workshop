import * as THREE from 'three';
import type { Transform3D } from '../gameplay/LevelData';

/**
 * 投影墙与世界的尺度常量。
 * 掩码画布取 288 × 160：18 × 10 的世界区域映射到该画布时，
 * 每个像素恰好对应 0.0625 × 0.0625 的世界单位（各向同性，避免 IoU 受方向影响）。
 */
export const WALL_Z = 0;
export const WALL_MIN_X = -9;
export const WALL_MAX_X = 9;
export const WALL_MIN_Y = 0.5;
export const WALL_MAX_Y = 10.5;
export const WALL_WIDTH = WALL_MAX_X - WALL_MIN_X; // 18
export const WALL_HEIGHT = WALL_MAX_Y - WALL_MIN_Y; // 10
export const MASK_W = 288;
export const MASK_H = 160;

/** 深度安全余量：物体与光源之间至少保持的距离，避免投影除数趋近 0 */
export const MIN_LIGHT_GAP = 2.0;

/** 物体允许的活动范围（世界坐标） */
export const OBJECT_LIMITS = {
  minX: -7,
  maxX: 7,
  minY: 1.2,
  maxY: 9.2,
  minZ: 1.2,
  maxZ: 7.0,
};

/** 光源允许的活动范围（世界坐标） */
export const LIGHT_LIMITS = {
  minX: -6,
  maxX: 6,
  minY: 2.5,
  maxY: 9.5,
  minZ: 10,
  maxZ: 20,
};

/** 把数值限制在 [min, max]，非法值（NaN / Infinity）回退到 fallback */
export function clampSafe(v: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/** 二维点 */
export interface Point2 {
  x: number;
  y: number;
}

/**
 * 点光源 + 平面投影（简化几何模型，非光学仿真）。
 *
 * 设光源 L = (Lx, Ly, Lz)，顶点 P = (Px, Py, Pz)，墙平面 z = Zw：
 *   t   = (Lz - Zw) / (Lz - Pz)
 *   Qx  = Lx + t * (Px - Lx)
 *   Qy  = Ly + t * (Py - Ly)
 *
 * 当 Pz 逼近 Lz 时除数趋近 0，此时返回 null 由调用方裁剪该顶点。
 */
export function projectPoint(
  L: THREE.Vector3Like,
  P: THREE.Vector3Like,
  wallZ: number = WALL_Z,
): Point2 | null {
  const denom = L.z - P.z;
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-4) return null;
  const t = (L.z - wallZ) / denom;
  if (!Number.isFinite(t) || t > 1e4) return null;
  return {
    x: L.x + t * (P.x - L.x),
    y: L.y + t * (P.y - L.y),
  };
}

/** 由变换构造世界矩阵（旋转顺序 XYZ，角度制） */
export function buildMatrix(t: Transform3D, scale = 1): THREE.Matrix4 {
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(t.rotationX),
    THREE.MathUtils.degToRad(t.rotationY),
    THREE.MathUtils.degToRad(t.rotationZ),
    'XYZ',
  );
  return new THREE.Matrix4().compose(
    new THREE.Vector3(t.x, t.y, t.z),
    new THREE.Quaternion().setFromEuler(euler),
    new THREE.Vector3(scale, scale, scale),
  );
}

/**
 * Andrew monotone chain 凸包。输入任意点集，返回按逆时针排列的凸包顶点。
 * 所有基础形状都是凸的，因此凸包即为其在墙面上的投影轮廓；
 * 同时凸包天然地把有厚度的前后两层顶点合并为一个外轮廓。
 */
export function convexHull(points: Point2[]): Point2[] {
  if (points.length <= 2) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point2, a: Point2, b: Point2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: Point2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/**
 * 将一个物体（其局部顶点由 localVertices 给出）投影到墙面，返回轮廓多边形。
 * 返回 null 表示该物体当前无法投影（例如深度非法）。
 */
export function projectShape(
  localVertices: THREE.Vector3Like[],
  transform: Transform3D,
  light: THREE.Vector3Like,
  scale = 1,
  wallZ: number = WALL_Z,
): Point2[] | null {
  const mat = buildMatrix(transform, scale);
  const v = new THREE.Vector3();
  const projected: Point2[] = [];
  for (const lv of localVertices) {
    v.set(lv.x, lv.y, lv.z).applyMatrix4(mat);
    const q = projectPoint(light, v, wallZ);
    if (q) projected.push(q);
  }
  if (projected.length < 3) return null;
  return convexHull(projected);
}

/** 把墙面世界坐标映射到掩码画布的像素坐标（浮点，未取整） */
export function wallToMask(p: Point2): Point2 {
  return {
    x: ((p.x - WALL_MIN_X) / WALL_WIDTH) * MASK_W,
    y: ((WALL_MAX_Y - p.y) / WALL_HEIGHT) * MASK_H,
  };
}

/** 把掩码画布像素坐标还原为墙面世界坐标 */
export function maskToWall(p: Point2): Point2 {
  return {
    x: WALL_MIN_X + (p.x / MASK_W) * WALL_WIDTH,
    y: WALL_MAX_Y - (p.y / MASK_H) * WALL_HEIGHT,
  };
}

/**
 * 用墙面矩形裁剪凸多边形（Sutherland–Hodgman）。
 * 超出墙面的部分被裁掉，保证“投影超出边界按墙面裁剪”。
 */
export function clipPolygonToWall(poly: Point2[]): Point2[] {
  let output = poly;
  const edges: Array<(p: Point2) => number> = [
    (p) => p.x - WALL_MIN_X,
    (p) => WALL_MAX_X - p.x,
    (p) => p.y - WALL_MIN_Y,
    (p) => WALL_MAX_Y - p.y,
  ];
  for (const inside of edges) {
    const input = output;
    output = [];
    if (input.length === 0) break;
    for (let i = 0; i < input.length; i++) {
      const cur = input[i];
      const prev = input[(i + input.length - 1) % input.length];
      const curIn = inside(cur) >= 0;
      const prevIn = inside(prev) >= 0;
      if (curIn) {
        if (!prevIn) output.push(intersect(prev, cur, inside));
        output.push(cur);
      } else if (prevIn) {
        output.push(intersect(prev, cur, inside));
      }
    }
  }
  return output;
}

function intersect(a: Point2, b: Point2, inside: (p: Point2) => number): Point2 {
  const da = inside(a);
  const db = inside(b);
  const t = da / (da - db);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}
