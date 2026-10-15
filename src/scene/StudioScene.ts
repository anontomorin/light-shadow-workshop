import * as THREE from 'three';
import {
  WALL_HEIGHT,
  WALL_MAX_X,
  WALL_MAX_Y,
  WALL_MIN_X,
  WALL_MIN_Y,
  WALL_WIDTH,
  WALL_Z,
} from '../projection/Projector';
import { getObjectPartGeometries } from './GeometryFactory';
import { ProjectionRenderer } from './ProjectionRenderer';
import type { ShadowObjectDefinition, Transform3D } from '../gameplay/LevelData';

/**
 * 三维工作室场景：投影墙、地面、灯架、可操作几何体、光源可视化。
 * 只负责"呈现"，不含任何关卡与判定逻辑。
 */

const COLOR_WALL = '#fdf9f1';
const COLOR_FLOOR = '#ece3d2';
const COLOR_FRAME = '#d8cdb8';
const COLOR_LAMP = '#ffcf7a';

/**
 * 一个可操作物体在场景中的呈现。
 *
 * 物体由"一组零件网格"构成（见 GeometryFactory 的零件模型）：
 *   凸形状 = 1 个网格；十字 = 3 个；五角星 = 6 个；圆环 = 18 个；
 *   花窗关卡的"外框""十字棂""菱花心"等构件则各自是一组棂条。
 * `group` 承担物体的世界变换（位置 / 姿态 / 选中脉动），零件网格只负责自身
 * 在物体局部坐标下的摆放（缩放 / 面内旋转 / 平移）。
 */
interface ObjectEntry {
  def: ShadowObjectDefinition;
  group: THREE.Group;
  meshes: THREE.Mesh[];
  outlines: THREE.LineSegments[];
  transform: Transform3D;
}

export class StudioScene {
  readonly root = new THREE.Group();
  readonly projection = new ProjectionRenderer();

  private objectGroup = new THREE.Group();
  private entries: ObjectEntry[] = [];
  private selectedId: string | null = null;

  private lampGroup = new THREE.Group();
  private lampStand: THREE.Mesh;
  private lampBulb: THREE.Mesh;
  private lampLight: THREE.PointLight;
  private lightPos = new THREE.Vector3(0, 5.5, 14);

  private disposables: Array<{ dispose(): void }> = [];
  private outlineMaterial: THREE.LineBasicMaterial;

  constructor() {
    this.root.add(this.objectGroup, this.projection.group, this.lampGroup);

    this.buildWall();
    this.buildFloor();
    this.buildLights();

    // 灯架
    const standGeo = new THREE.CylinderGeometry(0.07, 0.09, 1, 12);
    this.lampStand = new THREE.Mesh(
      standGeo,
      new THREE.MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.6, metalness: 0.2 }),
    );
    this.disposables.push(standGeo, this.lampStand.material as THREE.Material);

    const bulbGeo = new THREE.SphereGeometry(0.34, 20, 14);
    this.lampBulb = new THREE.Mesh(
      bulbGeo,
      new THREE.MeshBasicMaterial({ color: COLOR_LAMP }),
    );
    this.disposables.push(bulbGeo, this.lampBulb.material as THREE.Material);

    const shadeGeo = new THREE.ConeGeometry(0.62, 0.7, 20, 1, true);
    const shade = new THREE.Mesh(
      shadeGeo,
      new THREE.MeshStandardMaterial({
        color: '#f6e0b5',
        roughness: 0.5,
        metalness: 0.1,
        side: THREE.DoubleSide,
      }),
    );
    shade.position.y = 0.42;
    this.disposables.push(shadeGeo, shade.material as THREE.Material);
    this.lampBulb.add(shade);

    this.lampLight = new THREE.PointLight('#fff0d0', 90, 60, 2);
    this.lampBulb.add(this.lampLight);

    this.lampGroup.add(this.lampStand, this.lampBulb);

    this.outlineMaterial = new THREE.LineBasicMaterial({
      color: '#1f7f96',
      transparent: true,
      opacity: 0.95,
    });
    this.disposables.push(this.outlineMaterial);
  }

  // ───────────────────────── 环境 ─────────────────────────

  private buildWall(): void {
    const wallGeo = new THREE.PlaneGeometry(WALL_WIDTH, WALL_HEIGHT);
    const wallMat = new THREE.MeshStandardMaterial({
      color: COLOR_WALL,
      roughness: 0.95,
      metalness: 0,
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set((WALL_MIN_X + WALL_MAX_X) / 2, (WALL_MIN_Y + WALL_MAX_Y) / 2, WALL_Z);
    this.root.add(wall);
    this.disposables.push(wallGeo, wallMat);

    // 墙面边框（细线框，增强"画布"感）
    const frameGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(WALL_MIN_X, WALL_MIN_Y, WALL_Z + 0.01),
      new THREE.Vector3(WALL_MAX_X, WALL_MIN_Y, WALL_Z + 0.01),
      new THREE.Vector3(WALL_MAX_X, WALL_MAX_Y, WALL_Z + 0.01),
      new THREE.Vector3(WALL_MIN_X, WALL_MAX_Y, WALL_Z + 0.01),
      new THREE.Vector3(WALL_MIN_X, WALL_MIN_Y, WALL_Z + 0.01),
    ]);
    const frameMat = new THREE.LineBasicMaterial({ color: COLOR_FRAME });
    this.root.add(new THREE.Line(frameGeo, frameMat));
    this.disposables.push(frameGeo, frameMat);

    // 墙面刻度网格（浅色，帮助玩家判断位置）
    const gridPts: THREE.Vector3[] = [];
    for (let x = WALL_MIN_X + 3; x < WALL_MAX_X; x += 3) {
      gridPts.push(new THREE.Vector3(x, WALL_MIN_Y, WALL_Z + 0.005));
      gridPts.push(new THREE.Vector3(x, WALL_MAX_Y, WALL_Z + 0.005));
    }
    for (let y = WALL_MIN_Y + 2.5; y < WALL_MAX_Y; y += 2.5) {
      gridPts.push(new THREE.Vector3(WALL_MIN_X, y, WALL_Z + 0.005));
      gridPts.push(new THREE.Vector3(WALL_MAX_X, y, WALL_Z + 0.005));
    }
    const gridGeo = new THREE.BufferGeometry().setFromPoints(gridPts);
    const gridMat = new THREE.LineBasicMaterial({
      color: '#e4dac6',
      transparent: true,
      opacity: 0.6,
    });
    this.root.add(new THREE.LineSegments(gridGeo, gridMat));
    this.disposables.push(gridGeo, gridMat);
  }

  private buildFloor(): void {
    const floorGeo = new THREE.PlaneGeometry(46, 40);
    const floorMat = new THREE.MeshStandardMaterial({
      color: COLOR_FLOOR,
      roughness: 0.92,
      metalness: 0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, 10);
    this.root.add(floor);
    this.disposables.push(floorGeo, floorMat);
  }

  private buildLights(): void {
    const ambient = new THREE.AmbientLight('#ffffff', 0.55);
    const hemi = new THREE.HemisphereLight('#fff6e6', '#d9cfbb', 0.55);
    const dir = new THREE.DirectionalLight('#fff4e2', 0.85);
    dir.position.set(6, 16, 12);
    const fill = new THREE.DirectionalLight('#dfeaf2', 0.35);
    fill.position.set(-10, 6, 8);
    this.root.add(ambient, hemi, dir, fill);
  }

  // ───────────────────────── 物体 ─────────────────────────

  /** 根据关卡定义重建全部可操作物体 */
  setObjects(defs: ShadowObjectDefinition[], transforms: Transform3D[]): void {
    this.clearObjects();
    defs.forEach((def, i) => {
      const objectScale = def.scale ?? 1;
      const material = new THREE.MeshStandardMaterial({
        color: def.color,
        roughness: 0.55,
        metalness: 0.05,
        emissive: new THREE.Color(def.color).multiplyScalar(0.06),
      });
      this.disposables.push(material);

      const group = new THREE.Group();
      group.userData.objectId = def.id;
      const meshes: THREE.Mesh[] = [];
      const outlines: THREE.LineSegments[] = [];

      for (const placement of getObjectPartGeometries(def)) {
        const mesh = new THREE.Mesh(placement.geometry, material);
        mesh.position.set(placement.dx, placement.dy, 0);
        mesh.rotation.z = THREE.MathUtils.degToRad(placement.rot);
        mesh.scale.set(
          objectScale * placement.sx,
          objectScale * placement.sy,
          objectScale,
        );
        mesh.userData.objectId = def.id;
        // 描边随零件自身缩放，稍微外扩一点避免与实体共面闪烁
        const outlineGeo = new THREE.EdgesGeometry(placement.geometry, 25);
        const outline = new THREE.LineSegments(outlineGeo, this.outlineMaterial);
        outline.visible = false;
        outline.scale.setScalar(1.06);
        mesh.add(outline);
        meshes.push(mesh);
        outlines.push(outline);
        group.add(mesh);
      }

      this.objectGroup.add(group);
      const entry: ObjectEntry = { def, group, meshes, outlines, transform: { ...transforms[i] } };
      this.entries.push(entry);
      this.applyTransform(entry);
    });
  }

  private clearObjects(): void {
    for (const e of this.entries) {
      this.objectGroup.remove(e.group);
      // 几何体由 GeometryFactory 缓存并共享，这里只回收描边几何体（材质是共享的）
      for (const outline of e.outlines) outline.geometry.dispose();
      e.group.clear();
    }
    this.entries = [];
    this.selectedId = null;
  }

  private applyTransform(entry: ObjectEntry): void {
    const t = entry.transform;
    entry.group.position.set(t.x, t.y, t.z);
    entry.group.rotation.set(
      THREE.MathUtils.degToRad(t.rotationX),
      THREE.MathUtils.degToRad(t.rotationY),
      THREE.MathUtils.degToRad(t.rotationZ),
    );
  }

  updateTransform(id: string, t: Transform3D): void {
    const entry = this.entries.find((e) => e.def.id === id);
    if (!entry) return;
    entry.transform = { ...t };
    this.applyTransform(entry);
  }

  getObjectIds(): string[] {
    return this.entries.map((e) => e.def.id);
  }

  getPickables(): THREE.Object3D[] {
    return this.entries.flatMap((e) => e.meshes);
  }

  getObjectName(id: string): string {
    return this.entries.find((e) => e.def.id === id)?.def.name ?? '';
  }

  /** 设置选中物体，显示描边 */
  setSelected(id: string | null): void {
    this.selectedId = id;
    for (const e of this.entries) {
      const on = e.def.id === id;
      for (const outline of e.outlines) outline.visible = on;
    }
  }

  getSelected(): string | null {
    return this.selectedId;
  }

  // ───────────────────────── 光源 ─────────────────────────

  setLightPosition(p: { x: number; y: number; z: number }): void {
    this.lightPos.set(p.x, p.y, p.z);
    this.lampBulb.position.set(p.x, p.y, p.z);
    const standHeight = Math.max(0.2, p.y - 0.5);
    this.lampStand.scale.y = standHeight;
    this.lampStand.position.set(p.x, standHeight / 2, p.z);
  }

  // ───────────────────────── 每帧更新 ─────────────────────────

  update(dt: number): void {
    this.projection.update(dt);
    // 选中物体轻微脉动缩放，提供"已选中"的视觉反馈
    for (const e of this.entries) {
      if (e.def.id === this.selectedId) {
        e.group.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.015);
      } else if (e.group.scale.x !== 1) {
        e.group.scale.setScalar(1);
      }
    }
    // 灯光轻微呼吸，营造"影棚"氛围
    this.lampLight.intensity = 88 + Math.sin(performance.now() * 0.0012) * 6;
  }

  dispose(): void {
    this.clearObjects();
    this.projection.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
