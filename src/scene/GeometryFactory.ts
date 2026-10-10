import * as THREE from 'three';
import type { ShapeType } from '../gameplay/LevelData';

/** 薄片厚度：物体以“薄片”形式呈现，投影时前后两层顶点都会被计算 */
export const PLATE_THICKNESS = 0.3;

/** 各形状的基准尺寸（半尺寸 / 半径，单位：世界单位） */
const SHAPE_METRICS: Record<ShapeType, { radius?: number; halfW?: number; halfH?: number }> = {
  triangle: { radius: 0.95 },
  square: { halfW: 0.8, halfH: 0.8 },
  rectangle: { halfW: 1.35, halfH: 0.42 },
  circle: { radius: 0.85 },
  hexagon: { radius: 0.9 },
  diamond: { halfW: 1.15, halfH: 0.6 },
};

/** 圆形用 48 个顶点近似 */
const CIRCLE_SEGMENTS = 48;

const shapeCache = new Map<ShapeType, THREE.Vector2[]>();
const geometryCache = new Map<ShapeType, THREE.ExtrudeGeometry>();

/**
 * 生成形状的二维轮廓点（局部坐标，中心在原点，位于 XY 平面）。
 * 投影计算与渲染几何共用同一份点集，保证“看到的”与“判定的”完全一致。
 */
export function getShapeOutline(type: ShapeType): THREE.Vector2[] {
  const cached = shapeCache.get(type);
  if (cached) return cached;

  const m = SHAPE_METRICS[type];
  const pts: THREE.Vector2[] = [];

  if (type === 'circle') {
    for (let i = 0; i < CIRCLE_SEGMENTS; i++) {
      const a = (i / CIRCLE_SEGMENTS) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a) * (m.radius ?? 1), Math.sin(a) * (m.radius ?? 1)));
    }
  } else if (type === 'triangle') {
    const r = m.radius ?? 1;
    for (let i = 0; i < 3; i++) {
      const a = Math.PI / 2 + (i / 3) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
  } else if (type === 'hexagon') {
    const r = m.radius ?? 1;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      pts.push(new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r));
    }
  } else if (type === 'diamond') {
    const hw = m.halfW ?? 1;
    const hh = m.halfH ?? 1;
    pts.push(new THREE.Vector2(0, hh), new THREE.Vector2(-hw, 0), new THREE.Vector2(0, -hh), new THREE.Vector2(hw, 0));
  } else {
    // square / rectangle
    const hw = m.halfW ?? 1;
    const hh = m.halfH ?? 1;
    pts.push(
      new THREE.Vector2(-hw, -hh),
      new THREE.Vector2(hw, -hh),
      new THREE.Vector2(hw, hh),
      new THREE.Vector2(-hw, hh),
    );
  }

  shapeCache.set(type, pts);
  return pts;
}

/**
 * 供投影计算使用的局部顶点（前后两层，包含厚度）。
 * 返回普通对象数组，避免几何/投影模块之间产生不必要的耦合。
 */
export function getLocalVertices(type: ShapeType): THREE.Vector3[] {
  const outline = getShapeOutline(type);
  const half = PLATE_THICKNESS / 2;
  const verts: THREE.Vector3[] = [];
  for (const p of outline) {
    verts.push(new THREE.Vector3(p.x, p.y, -half));
  }
  for (const p of outline) {
    verts.push(new THREE.Vector3(p.x, p.y, half));
  }
  return verts;
}

/** 生成（并缓存）薄片几何体，几何体在 Z 方向居中 */
export function getPlateGeometry(type: ShapeType): THREE.ExtrudeGeometry {
  const cached = geometryCache.get(type);
  if (cached) return cached;

  const outline = getShapeOutline(type);
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: PLATE_THICKNESS,
    bevelEnabled: false,
    curveSegments: 1,
  });
  geo.translate(0, 0, -PLATE_THICKNESS / 2);
  geo.computeVertexNormals();
  geometryCache.set(type, geo);
  return geo;
}

/** 形状的中文名 */
export const SHAPE_LABEL: Record<ShapeType, string> = {
  triangle: '三角形',
  square: '正方形',
  rectangle: '长方形',
  circle: '圆形',
  hexagon: '六边形',
  diamond: '菱形',
};

/** 释放全部缓存的几何体资源 */
export function disposeGeometryCache(): void {
  geometryCache.forEach((g) => g.dispose());
  geometryCache.clear();
}
