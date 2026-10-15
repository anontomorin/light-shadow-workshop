import * as THREE from 'three';
import {
  MIN_LIGHT_GAP,
  WALL_MAX_X,
  WALL_MAX_Y,
  WALL_MIN_X,
  WALL_MIN_Y,
  WALL_Z,
  clipPolygonToWall,
  convexHull,
  projectPoint,
  type Point2,
} from './Projector';
import { barLocalVertices, extractBars, type BarSegment } from '../window-builder/WindowGeometryBuilder';
import type { WindowDocument } from '../patterns/types';

/**
 * 多构件（多棂条）投影适配器 —— 本项目的关键技术点。
 *
 * 为什么不能"整扇窗求一次凸包"：
 *   现有 `projectParts()` 会对一个物体的全部投影点求一次凸包。窗棂是
 *   「实体棂条 + 镂空窗格」的结构，如果把整扇窗的所有顶点汇总求凸包，
 *   凸包会把窗格空隙全部填死，影子变成一块实心方块 —— 视觉与匹配双双失真。
 *
 * 正确做法（对应开发文档 6.1）：
 *   窗格文档 → 逐根杆件取局部顶点 → 应用 matrixWorld → projectPoint 投到墙平面
 *   → **对单根杆件内部**求凸包得到一个 polygon → 所有 polygon 交给
 *   `SilhouetteRasterizer.rasterize(polygons)` 做并集。
 *   空隙里没有 polygon，掩码自然保持为 0。
 *
 * 本文件同时提供两条路径：
 *   - `projectWindowBars()`：解析式计算（纯函数，Node 里可直接测）；
 *   - `projectWindowGroup()`：遍历真实 Mesh，读取几何顶点与 matrixWorld（渲染路径）。
 *   两者的结果必须逐点一致，由 scripts/verify-window.ts 断言。
 */

export interface ProjectionBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface WindowProjection {
  /** 全部杆件的投影多边形（墙面坐标，已按墙面矩形裁剪） */
  polygons: Point2[][];
  /** 投影轮廓在墙面上的包围盒（基于裁剪后的可见轮廓） */
  bounds: ProjectionBounds | null;
  /** 杆件总数 */
  bars: number;
  /** 成功投影出有效轮廓的杆件数 */
  projectedBars: number;
  /** 无法投影的杆件数（深度非法 / 顶点不足） */
  failedBars: number;
  /** 是否存在部分构件投影失败 */
  partial: boolean;
  /** 面向用户的提示，空串表示一切正常 */
  note: string;
}

/** 所有成功投影的点（未裁剪），用于诊断 */
export interface RawProjection {
  points: Point2[];
  failedBars: number;
  bars: number;
}

function emptyResult(bars: number, note: string): WindowProjection {
  return {
    polygons: [],
    bounds: null,
    bars,
    projectedBars: 0,
    failedBars: bars,
    partial: bars > 0,
    note,
  };
}

/** 由多边形集合计算包围盒 */
export function boundsOfPolygons(polygons: Point2[][]): ProjectionBounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const p of poly) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/** 一组点的包围盒 */
export function boundsOfPoints(points: Point2[]): ProjectionBounds | null {
  return boundsOfPolygons([points]);
}

function finalize(
  polygons: Point2[][],
  bars: number,
  projectedBars: number,
  failedBars: number,
  shallowestGap: number,
): WindowProjection {
  const partial = failedBars > 0;
  let note = '';
  if (bars === 0) {
    note = '当前窗格没有可投影的构件。';
  } else if (projectedBars === 0) {
    note =
      shallowestGap < MIN_LIGHT_GAP
        ? '窗格与光源的深度过于接近，投影无法计算。请把窗格往后移（减小深度）或把光源往前移。'
        : '全部构件当前都无法投影，请检查窗格深度与光源位置。';
  } else if (partial) {
    note =
      shallowestGap < MIN_LIGHT_GAP
        ? `部分构件离光源过近（安全余量需 ≥ ${MIN_LIGHT_GAP}），墙上显示的是不完整轮廓。`
        : `部分构件当前无法投影（${failedBars}/${bars}），墙上显示的是不完整轮廓。`;
  }
  return {
    polygons,
    bounds: boundsOfPolygons(polygons),
    bars,
    projectedBars,
    failedBars,
    partial,
    note,
  };
}

/**
 * 解析式多杆件投影（纯函数）。
 * @param bars         由 extractBars(doc) 得到的杆件列表
 * @param matrixWorld  窗格整体（含父级链）的世界矩阵
 */
export function projectWindowBars(
  bars: BarSegment[],
  matrixWorld: THREE.Matrix4,
  light: THREE.Vector3Like,
  wallZ: number = WALL_Z,
): WindowProjection {
  if (bars.length === 0) return emptyResult(0, '当前窗格没有可投影的构件。');

  const polygons: Point2[][] = [];
  let projectedBars = 0;
  let failedBars = 0;
  let shallowestGap = Infinity;

  for (const bar of bars) {
    const projected: Point2[] = [];
    let barGap = Infinity;
    for (const local of barLocalVertices(bar)) {
      const world = local.clone().applyMatrix4(matrixWorld);
      barGap = Math.min(barGap, light.z - world.z);
      const q = projectPoint(light, world, wallZ);
      if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) projected.push(q);
    }
    shallowestGap = Math.min(shallowestGap, barGap);
    // 深度安全：与光源过近（或已在光源之后）的构件不参与投影，
    // 避免出现镜像/无穷放大的伪影子污染墙面。
    if (barGap < MIN_LIGHT_GAP) {
      failedBars++;
      continue;
    }
    if (projected.length < 3) {
      failedBars++;
      continue;
    }
    const hull = convexHull(projected);
    const clipped = clipPolygonToWall(hull);
    if (clipped.length >= 3) {
      polygons.push(clipped);
      projectedBars++;
    } else {
      failedBars++;
    }
  }

  if (!Number.isFinite(shallowestGap)) shallowestGap = 0;
  return finalize(polygons, bars.length, projectedBars, failedBars, shallowestGap);
}

/**
 * 渲染路径：遍历真实的窗格 Group，逐 Mesh 读取几何 position 顶点，
 * 应用 matrixWorld 后投影。跳过装饰件（玻璃面）。
 *
 * 调用前必须保证 matrixWorld 已更新（内部会强制 updateMatrixWorld）。
 */
export function projectWindowGroup(
  group: THREE.Object3D,
  light: THREE.Vector3Like,
  wallZ: number = WALL_Z,
): WindowProjection {
  group.updateMatrixWorld(true);

  const polygons: Point2[][] = [];
  let bars = 0;
  let projectedBars = 0;
  let failedBars = 0;
  let shallowestGap = Infinity;
  const v = new THREE.Vector3();

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.userData.decor === true) return;
    const pos = mesh.geometry?.getAttribute?.('position');
    if (!pos) return;

    bars++;
    const projected: Point2[] = [];
    let barGap = Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
      barGap = Math.min(barGap, light.z - v.z);
      const q = projectPoint(light, v, wallZ);
      if (q && Number.isFinite(q.x) && Number.isFinite(q.y)) projected.push(q);
    }
    shallowestGap = Math.min(shallowestGap, barGap);
    if (barGap < MIN_LIGHT_GAP) {
      failedBars++;
      return;
    }
    if (projected.length < 3) {
      failedBars++;
      return;
    }
    const hull = convexHull(projected);
    const clipped = clipPolygonToWall(hull);
    if (clipped.length >= 3) {
      polygons.push(clipped);
      projectedBars++;
    } else {
      failedBars++;
    }
  });

  if (bars === 0) return emptyResult(0, '当前窗格没有可投影的构件。');
  if (!Number.isFinite(shallowestGap)) shallowestGap = 0;
  return finalize(polygons, bars, projectedBars, failedBars, shallowestGap);
}

/** 便捷入口：直接从文档 + 世界矩阵投影（解析式，不依赖场景） */
export function projectWindowDocument(
  doc: WindowDocument,
  matrixWorld: THREE.Matrix4,
  light: THREE.Vector3Like,
  wallZ: number = WALL_Z,
): WindowProjection {
  return projectWindowBars(extractBars(doc), matrixWorld, light, wallZ);
}

/**
 * 代表性光线（"示意光线"）：从光源到若干采样顶点的线段。
 * 只用于可视化，不参与任何测量；测量一律来自真实的投影多边形。
 */
export function representativeRays(
  group: THREE.Object3D,
  light: THREE.Vector3Like,
  maxRays = 24,
): Array<[THREE.Vector3, THREE.Vector3]> {
  group.updateMatrixWorld(true);
  const samples: THREE.Vector3[] = [];
  const v = new THREE.Vector3();
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.decor === true) return;
    const pos = mesh.geometry?.getAttribute?.('position');
    if (!pos) return;
    for (let i = 0; i < pos.count; i += Math.max(1, Math.floor(pos.count / 4))) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld);
      samples.push(v.clone());
    }
  });
  if (samples.length === 0) return [];

  // 均匀抽样到 maxRays 条，避免线太多看不清
  const step = Math.max(1, Math.ceil(samples.length / maxRays));
  const rays: Array<[THREE.Vector3, THREE.Vector3]> = [];
  const L = new THREE.Vector3(light.x, light.y, light.z);
  for (let i = 0; i < samples.length; i += step) {
    const p = samples[i];
    const q = projectPoint(light, p);
    if (!q) continue;
    rays.push([L.clone(), new THREE.Vector3(q.x, q.y, WALL_Z)]);
  }
  return rays;
}

/** 墙面范围常量再导出，方便 UI 层做越界提示 */
export const WALL_BOUNDS = {
  minX: WALL_MIN_X,
  maxX: WALL_MAX_X,
  minY: WALL_MIN_Y,
  maxY: WALL_MAX_Y,
};
