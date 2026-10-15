import * as THREE from 'three';
import type { LatticeRole, WindowDocument } from '../patterns/types';

/**
 * 窗棂杆件几何构造器。
 *
 * 关键设计（同时决定了"显示"与"投影"的一致性）：
 *   - 每条 stroke 的每一段被拆成一根**独立杆件**（BoxGeometry 的长方体）。
 *   - 所有杆件共用同一个单位立方体几何（1×1×1）与同一份材质，
 *     通过 mesh.scale = (长度, 宽度, 厚度) + mesh.rotation.z = 段倾角 摆放。
 *     three 的局部矩阵是 T·R·S，因此杆件的 8 个顶点恰好等于
 *     "把 (±L/2, ±W/2, ±D/2) 绕 Z 旋转角度后平移到段中点"。
 *   - 投影模块使用的 `barLocalVertices()` 就是按这个解析式算出来的，
 *     与 GPU 实际渲染的顶点**逐字节等价**（见 scripts/verify-window.ts 的一致性断言）。
 *     于是"看到的样子"和"算出来的轮廓"不可能是两套算法。
 *
 * 杆件通过 userData 记录稳定的 strokeId / segmentIndex，供选中与高亮使用。
 */

export interface BarSegment {
  strokeId: string;
  segmentIndex: number;
  role: LatticeRole;
  source: 'template' | 'user';
  /** 段中点（窗格局部坐标） */
  cx: number;
  cy: number;
  /** 段方向角（弧度，绕 Z） */
  angle: number;
  /** 段长度 */
  length: number;
  /** 杆件在平面内的宽度 */
  width: number;
  /** 杆件厚度（Z 方向） */
  depth: number;
}

/** 杆件的最小长度：短于此值的退化段直接丢弃，避免 NaN 与不可见的碎屑 */
const MIN_BAR_LENGTH = 1e-3;

/**
 * 把窗格文档拆成杆件列表。纯函数，不创建任何 Three.js 对象，
 * 因此可以直接在 Node 测试里调用。
 */
export function extractBars(doc: WindowDocument): BarSegment[] {
  const bars: BarSegment[] = [];
  const depth = doc.depth;

  for (const stroke of doc.strokes) {
    if (!stroke || stroke.points.length < 2) continue;
    const width = stroke.width;
    if (!Number.isFinite(width) || width <= 0) continue;

    let segIndex = 0;
    for (let i = 1; i < stroke.points.length; i++) {
      const a = stroke.points[i - 1];
      const b = stroke.points[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (!Number.isFinite(length) || length < MIN_BAR_LENGTH) {
        segIndex++;
        continue;
      }
      if (!Number.isFinite(a.x) || !Number.isFinite(a.y) || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
        segIndex++;
        continue;
      }
      bars.push({
        strokeId: stroke.id,
        segmentIndex: segIndex,
        role: stroke.role,
        source: stroke.source,
        cx: (a.x + b.x) / 2,
        cy: (a.y + b.y) / 2,
        angle: Math.atan2(dy, dx),
        length,
        width,
        depth,
      });
      segIndex++;
    }
  }
  return bars;
}

/**
 * 单根杆件的 8 个局部顶点（窗格局部坐标系，Z 方向以 0 为中心）。
 * 顺序与单位立方体的角点一致，用于投影与一致性测试。
 */
export function barLocalVertices(bar: BarSegment): THREE.Vector3[] {
  const hl = bar.length / 2;
  const hw = bar.width / 2;
  const hd = bar.depth / 2;
  const cos = Math.cos(bar.angle);
  const sin = Math.sin(bar.angle);
  const out: THREE.Vector3[] = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const x = hl * sx;
        const y = hw * sy;
        out.push(
          new THREE.Vector3(
            bar.cx + (x * cos - y * sin),
            bar.cy + (x * sin + y * cos),
            hd * sz,
          ),
        );
      }
    }
  }
  return out;
}

/** 杆件的 4 个平面角点（不含厚度），用于 2D 绘制与海报 */
export function barPlanCorners(bar: BarSegment): Array<{ x: number; y: number }> {
  const hl = bar.length / 2;
  const hw = bar.width / 2;
  const cos = Math.cos(bar.angle);
  const sin = Math.sin(bar.angle);
  const pts: Array<{ x: number; y: number }> = [];
  for (const s of [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ] as const) {
    const x = hl * s[0];
    const y = hw * s[1];
    pts.push({ x: bar.cx + (x * cos - y * sin), y: bar.cy + (x * sin + y * cos) });
  }
  return pts;
}

export interface WindowMaterials {
  base: THREE.Material;
  selected: THREE.Material;
  edge: THREE.Material;
  glass: THREE.Material;
}

/** 木色窗棂 + 选中高亮（颜色 + 描边双通道，不只靠颜色区分） */
export function createWindowMaterials(): WindowMaterials {
  const base = new THREE.MeshStandardMaterial({
    color: '#8a5a33',
    roughness: 0.62,
    metalness: 0.04,
  });
  const selected = new THREE.MeshStandardMaterial({
    color: '#c2452d',
    roughness: 0.5,
    metalness: 0.06,
    emissive: new THREE.Color('#c2452d').multiplyScalar(0.22),
  });
  const edge = new THREE.LineBasicMaterial({ color: '#5a3a20', transparent: true, opacity: 0.55 });
  const glass = new THREE.MeshBasicMaterial({
    color: '#eaf1f5',
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { base, selected, edge, glass };
}

/** 单位立方体几何，所有杆件共用（避免为每根杆件新建几何体） */
const unitBox = new THREE.BoxGeometry(1, 1, 1);

export interface WindowGeometryResult {
  group: THREE.Group;
  bars: BarSegment[];
  /** strokeId → 杆件 Mesh 列表 */
  meshesByStroke: Map<string, THREE.Mesh[]>;
}

/**
 * 由窗格文档构造一个 Three.js Group。
 *
 * 返回的 Group 本身**不带变换**（位于窗格局部坐标系原点），
 * 由调用方（WorkshopStage）负责设置整体位置 / 旋转 / 深度。
 */
export function buildWindowGroup(
  doc: WindowDocument,
  materials: WindowMaterials,
): WindowGeometryResult {
  const group = new THREE.Group();
  group.name = 'window-lattice';
  const bars = extractBars(doc);
  const meshesByStroke = new Map<string, THREE.Mesh[]>();

  for (const bar of bars) {
    const mesh = new THREE.Mesh(unitBox, materials.base);
    mesh.scale.set(bar.length, bar.width, bar.depth);
    mesh.rotation.z = bar.angle;
    mesh.position.set(bar.cx, bar.cy, 0);
    // objectId = strokeId：射线拾取返回的是"哪一根棂条被点中"，
    // 而 WorkshopStage 会把任何 stroke 的变换都映射到整扇窗上（见该文件说明）。
    mesh.userData.objectId = bar.strokeId;
    mesh.userData.strokeId = bar.strokeId;
    mesh.userData.segmentIndex = bar.segmentIndex;
    mesh.userData.role = bar.role;
    group.add(mesh);

    const list = meshesByStroke.get(bar.strokeId);
    if (list) list.push(mesh);
    else meshesByStroke.set(bar.strokeId, [mesh]);
  }

  // 玻璃面：只做视觉暗示（窗格是"窗"而不是"架子"），不参与投影与拾取
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.1, doc.width - doc.frameWidth), Math.max(0.1, doc.height - doc.frameWidth)),
    materials.glass,
  );
  glass.name = 'window-glass';
  glass.userData.decor = true;
  glass.renderOrder = -1;
  group.add(glass);

  return { group, bars, meshesByStroke };
}

/**
 * 释放一个窗格 Group 中由本模块创建的资源。
 * 单位立方体几何是共享缓存，不能在这里 dispose。
 */
export function disposeWindowGroup(group: THREE.Group | null): void {
  if (!group) return;
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry && mesh.geometry !== unitBox) {
      // 玻璃面等一次性几何；共享的单位立方体不在这里释放
      mesh.geometry.dispose();
    }
  });
  group.clear();
}

export function disposeWindowMaterials(m: WindowMaterials): void {
  m.base.dispose();
  m.selected.dispose();
  m.edge.dispose();
  m.glass.dispose();
}

/** 释放共享的单位立方体几何（仅在应用销毁时调用） */
export function disposeSharedBarGeometry(): void {
  unitBox.dispose();
}
