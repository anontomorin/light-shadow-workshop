import * as THREE from 'three';
import type { InteractiveStage } from '../gameplay/InteractionController';
import type { Transform3D } from '../gameplay/LevelData';
import { buildMatrix } from '../projection/Projector';
import type { WindowDocument } from '../patterns/types';
import {
  buildWindowGroup,
  createWindowMaterials,
  disposeWindowGroup,
  disposeWindowMaterials,
  type BarSegment,
  type WindowMaterials,
} from '../window-builder/WindowGeometryBuilder';

/**
 * 花窗工坊的舞台：把窗格文档呈现为三维场景中的一组棂条杆件，
 * 并实现 `InteractiveStage`，从而复用关卡那套选中 / 拖动 / 旋转 / 键盘微调逻辑。
 *
 * 一个关键取舍：拖动时移动的是**整扇窗**，但拾取到的是**某一根棂条**。
 * 做法是把每一根 stroke 的 id 都登记到同一份变换上 —— 于是 InteractionController
 * 无论碰到哪根棂条，改写的都是窗格的整体变换，同时"选中了哪根棂条"这个信息
 * 被完整保留下来用于高亮，不需要改动交互控制器的任何代码。
 */
export class WorkshopStage implements InteractiveStage {
  readonly root = new THREE.Group();

  private materials: WindowMaterials;
  private windowGroup: THREE.Group | null = null;
  private bars: BarSegment[] = [];
  private meshes: THREE.Mesh[] = [];
  private outlines = new Map<string, THREE.LineSegments[]>();
  private pickables: THREE.Object3D[] = [];

  private transform: Transform3D = { x: 0, y: 5.2, z: 3.6, rotationX: 0, rotationY: 0, rotationZ: 0 };
  private selectedId: string | null = null;
  private doc: WindowDocument | null = null;

  constructor() {
    this.materials = createWindowMaterials();
    this.root.name = 'workshop-stage';
    this.applyTransform();
  }

  /** 重建窗格几何（模板切换、参数变化、自绘笔画变更时调用） */
  setDocument(doc: WindowDocument): void {
    this.doc = doc;
    if (this.windowGroup) {
      this.root.remove(this.windowGroup);
      disposeWindowGroup(this.windowGroup);
      this.windowGroup = null;
    }
    this.outlines.clear();
    this.meshes = [];
    this.pickables = [];

    const built = buildWindowGroup(doc, this.materials);
    this.windowGroup = built.group;
    this.bars = built.bars;
    this.root.add(built.group);
    built.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.decor !== true) {
        this.meshes.push(mesh);
        this.pickables.push(mesh);
      }
    });
    this.applyTransform();
    // 重建后保持选中（若该 stroke 已不存在则清空，由控制器决定新的默认选中）
    if (this.selectedId && !this.bars.some((b) => b.strokeId === this.selectedId)) {
      this.selectedId = null;
    }
    this.refreshHighlight();
  }

  get barCount(): number {
    return this.bars.length;
  }

  getBarSegments(): BarSegment[] {
    return this.bars;
  }

  getDocument(): WindowDocument | null {
    return this.doc;
  }

  /** 当前窗格的世界矩阵（供解析式投影与导出一致性使用） */
  worldMatrix(): THREE.Matrix4 {
    this.root.updateMatrixWorld(true);
    return this.windowGroup ? this.windowGroup.matrixWorld.clone() : buildMatrix(this.transform);
  }

  getTransform(): Transform3D {
    return { ...this.transform };
  }

  /** 供 InteractionController.syncTransforms 使用：每根棂条都指向同一份窗格变换 */
  transformsForAllStrokes(): Map<string, Transform3D> {
    const map = new Map<string, Transform3D>();
    for (const bar of this.bars) {
      map.set(bar.strokeId, { ...this.transform });
    }
    return map;
  }

  // ───────────────────────── InteractiveStage ─────────────────────────

  getPickables(): THREE.Object3D[] {
    return this.pickables;
  }

  getSelected(): string | null {
    return this.selectedId;
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.refreshHighlight();
  }

  /**
   * 无论传入的是哪一根 stroke 的 id，都改写整扇窗的变换。
   * 这样"点中一根棂条"既能高亮它，又能拖着整扇窗走。
   */
  updateTransform(_id: string, t: Transform3D): void {
    this.transform = { ...t };
    this.applyTransform();
  }

  /** 程序化设置窗格变换（滑杆 / 实验复位） */
  setTransform(t: Transform3D): void {
    this.transform = { ...t };
    this.applyTransform();
  }

  // ───────────────────────── 内部 ─────────────────────────

  private applyTransform(): void {
    const t = this.transform;
    this.root.position.set(t.x, t.y, t.z);
    this.root.rotation.set(
      THREE.MathUtils.degToRad(t.rotationX),
      THREE.MathUtils.degToRad(t.rotationY),
      THREE.MathUtils.degToRad(t.rotationZ),
    );
    this.root.updateMatrixWorld(true);
  }

  /**
   * 选中反馈：材质高亮 + 描边，两条通道同时生效。
   * 描边按需创建并缓存，避免为每一根棂条常驻 EdgesGeometry。
   */
  private refreshHighlight(): void {
    const selectedMeshes: THREE.Mesh[] = [];

    for (const mesh of this.meshes) {
      const strokeId = mesh.userData.strokeId as string;
      const isSelected = this.selectedId !== null && strokeId === this.selectedId;
      const want = isSelected ? this.materials.selected : this.materials.base;
      if (mesh.material !== want) mesh.material = want;
      if (isSelected) selectedMeshes.push(mesh);
      this.setOutlineVisible(strokeId, isSelected);
    }

    // 选中描边按需创建并缓存（不为每一根棂条常驻 EdgesGeometry）
    if (selectedMeshes.length > 0 && !this.outlines.has(this.selectedId as string)) {
      const lines = selectedMeshes.map((m) => {
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(m.geometry, 25),
          this.materials.edge,
        );
        edges.scale.copy(m.scale);
        edges.rotation.copy(m.rotation);
        edges.position.copy(m.position);
        edges.renderOrder = 40;
        m.parent?.add(edges);
        return edges;
      });
      this.outlines.set(this.selectedId as string, lines);
    }
  }

  private setOutlineVisible(strokeId: string, visible: boolean): void {
    const lines = this.outlines.get(strokeId);
    if (!lines) return;
    for (const l of lines) l.visible = visible;
  }

  /** 当前被高亮的 stroke 的杆件数量（供自动化测试断言选中确实生效） */
  highlightedBarCount(): number {
    return this.meshes.filter((m) => m.material === this.materials.selected).length;
  }

  dispose(): void {
    if (this.windowGroup) {
      this.root.remove(this.windowGroup);
      disposeWindowGroup(this.windowGroup);
      this.windowGroup = null;
    }
    for (const lines of this.outlines.values()) {
      for (const l of lines) l.geometry.dispose();
    }
    this.outlines.clear();
    disposeWindowMaterials(this.materials);
    this.meshes = [];
    this.pickables = [];
    this.bars = [];
  }
}
