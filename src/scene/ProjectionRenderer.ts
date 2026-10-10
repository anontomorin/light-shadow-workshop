import * as THREE from 'three';
import { WALL_Z, type Point2 } from '../projection/Projector';

/**
 * 把投影多边形渲染到投影墙上。
 *
 * 关键约束：当前影子与目标轮廓使用完全相同的墙面坐标映射，
 * 因此玩家在屏幕上看到的位置关系与 IoU 判定结果必然一致。
 *
 * 层次顺序（z 越大越靠前）：
 *   目标填充 WALL_Z + 0.01 → 当前影子 WALL_Z + 0.02 → 目标描边 WALL_Z + 0.05
 */
const Z_TARGET_FILL = WALL_Z + 0.01;
const Z_SHADOW = WALL_Z + 0.02;
const Z_TARGET_STROKE = WALL_Z + 0.05;

export class ProjectionRenderer {
  readonly group = new THREE.Group();

  private shadowGroup = new THREE.Group();
  private targetFillGroup = new THREE.Group();
  private targetStrokeGroup = new THREE.Group();

  private shadowMaterial: THREE.MeshBasicMaterial;
  private targetFillMaterial: THREE.MeshBasicMaterial;
  private targetStrokeMaterial: THREE.LineBasicMaterial;

  private highlight = 0;

  constructor() {
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#31455a'),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetFillMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#2f8fa8'),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.targetStrokeMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color('#1f7f96'),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });

    this.group.add(this.shadowGroup, this.targetFillGroup, this.targetStrokeGroup);
  }

  /** 更新当前影子（统一实心填充，重叠区域自然合并） */
  setCurrent(polygons: Point2[][]): void {
    this.rebuildFilled(this.shadowGroup, polygons, Z_SHADOW, this.shadowMaterial);
  }

  /** 更新目标轮廓（淡填充 + 描边，固定在墙上，不随玩家操作变化） */
  setTarget(polygons: Point2[][]): void {
    this.rebuildFilled(this.targetFillGroup, polygons, Z_TARGET_FILL, this.targetFillMaterial);
    this.rebuildStroke(this.targetStrokeGroup, polygons, Z_TARGET_STROKE);
  }

  private rebuildFilled(
    group: THREE.Group,
    polygons: Point2[][],
    z: number,
    material: THREE.Material,
  ): void {
    disposeChildren(group);
    for (const poly of polygons) {
      if (!poly || poly.length < 3) continue;
      const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
      const geo = new THREE.ShapeGeometry(shape);
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.z = z;
      group.add(mesh);
    }
  }

  private rebuildStroke(group: THREE.Group, polygons: Point2[][], z: number): void {
    disposeChildren(group);
    for (const poly of polygons) {
      if (!poly || poly.length < 3) continue;
      const loop = poly.map((p) => new THREE.Vector3(p.x, p.y, z));
      loop.push(loop[0].clone());
      const geo = new THREE.BufferGeometry().setFromPoints(loop);
      group.add(new THREE.Line(geo, this.targetStrokeMaterial));
    }
  }

  /** 通关演出：让目标轮廓短暂发亮 */
  flash(duration = 1.1): void {
    this.highlight = duration;
  }

  update(dt: number): void {
    if (this.highlight > 0) {
      this.highlight = Math.max(0, this.highlight - dt);
      const k = Math.sin((this.highlight / 1.1) * Math.PI);
      this.targetStrokeMaterial.opacity = 0.7 + k * 0.3;
      this.targetFillMaterial.opacity = 0.16 + k * 0.3;
      this.shadowMaterial.color.setHex(k > 0.01 ? 0x3f6d84 : 0x31455a);
    } else if (this.targetStrokeMaterial.opacity !== 0.7) {
      this.targetStrokeMaterial.opacity = 0.7;
      this.targetFillMaterial.opacity = 0.16;
      this.shadowMaterial.color.setHex(0x31455a);
    }
  }

  dispose(): void {
    disposeChildren(this.shadowGroup);
    disposeChildren(this.targetFillGroup);
    disposeChildren(this.targetStrokeGroup);
    this.shadowMaterial.dispose();
    this.targetFillMaterial.dispose();
    this.targetStrokeMaterial.dispose();
  }
}

function disposeChildren(group: THREE.Group): void {
  for (const child of group.children.slice()) {
    group.remove(child);
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  }
}
