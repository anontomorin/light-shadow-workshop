import * as THREE from 'three';
import type { SceneManager } from '../scene/SceneManager';
import type { StudioScene } from '../scene/StudioScene';
import { OBJECT_LIMITS, clampSafe } from '../projection/Projector';
import type { LevelControls, Transform3D } from './LevelData';

/**
 * 物体交互控制器：选中、拖动、旋转。
 *
 * 拖动方式：把鼠标射线与"物体当前深度所在的、平行于投影墙的平面"求交，
 * 并保留按下瞬间物体中心与交点的偏移量，避免物体在屏幕上突然跳跃。
 */

export interface InteractionCallbacks {
  onSelect: (id: string | null) => void;
  onChange: (id: string, transform: Transform3D) => void;
  /** 拖动结束（用于触发一次完整精度的匹配校验） */
  onCommit: () => void;
}

export class InteractionController {
  private scene: StudioScene;
  private sceneManager: SceneManager;
  private cb: InteractionCallbacks;
  private controls: LevelControls;

  private raycaster = new THREE.Raycaster();
  private dragPlane = new THREE.Plane();
  private dragOffset = new THREE.Vector3();
  private dragging = false;
  private enabled = false;
  private hoverId: string | null = null;

  private transforms: Map<string, Transform3D> = new Map();
  private cleanup: Array<() => void> = [];
  private canvas: HTMLCanvasElement;

  constructor(
    scene: StudioScene,
    sceneManager: SceneManager,
    controls: LevelControls,
    cb: InteractionCallbacks,
  ) {
    this.scene = scene;
    this.sceneManager = sceneManager;
    this.controls = controls;
    this.cb = cb;
    this.canvas = sceneManager.domElement;

    const onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
    const onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
    const onPointerUp = (e: PointerEvent) => this.handlePointerUp(e);
    const onKeyDown = (e: KeyboardEvent) => this.handleKeyDown(e);

    this.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);

    this.cleanup.push(
      () => this.canvas.removeEventListener('pointerdown', onPointerDown),
      () => window.removeEventListener('pointermove', onPointerMove),
      () => window.removeEventListener('pointerup', onPointerUp),
      () => window.removeEventListener('keydown', onKeyDown),
    );
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) {
      this.dragging = false;
      this.canvas.style.cursor = 'default';
    }
  }

  setControls(controls: LevelControls): void {
    this.controls = controls;
  }

  /** 同步外部（如重置、关卡加载）产生的变换数据 */
  syncTransforms(transforms: Map<string, Transform3D>): void {
    this.transforms = new Map(
      Array.from(transforms, ([k, v]) => [k, { ...v }] as [string, Transform3D]),
    );
  }

  getTransform(id: string): Transform3D | undefined {
    return this.transforms.get(id);
  }

  // ───────────────────────── 指针事件 ─────────────────────────

  private pick(e: PointerEvent): string | null {
    const ndc = this.sceneManager.toNDC(e.clientX, e.clientY);
    this.raycaster.setFromCamera(ndc, this.sceneManager.camera);
    const hits = this.raycaster.intersectObjects(this.scene.getPickables(), false);
    if (hits.length === 0) return null;
    return (hits[0].object.userData.objectId as string) ?? null;
  }

  private handlePointerDown(e: PointerEvent): void {
    if (!this.enabled || e.button !== 0) return;
    const id = this.pick(e);
    if (!id) {
      this.scene.setSelected(null);
      this.cb.onSelect(null);
      return;
    }
    this.scene.setSelected(id);
    this.cb.onSelect(id);

    if (!this.controls.move) return;

    const t = this.transforms.get(id);
    if (!t) return;

    // 构造拖动平面：过物体中心、平行于投影墙
    this.dragPlane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(t.x, t.y, t.z),
    );
    const hit = this.intersectPlane(e);
    if (hit) this.dragOffset.set(t.x - hit.x, t.y - hit.y, 0);
    else this.dragOffset.set(0, 0, 0);

    this.dragging = true;
    this.canvas.style.cursor = 'grabbing';
    this.canvas.setPointerCapture?.(e.pointerId);
  }

  private intersectPlane(e: PointerEvent): THREE.Vector3 | null {
    const ndc = this.sceneManager.toNDC(e.clientX, e.clientY);
    this.raycaster.setFromCamera(ndc, this.sceneManager.camera);
    const out = new THREE.Vector3();
    const hit = this.raycaster.ray.intersectPlane(this.dragPlane, out);
    return hit ? out : null;
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.enabled) return;
    if (!this.dragging) {
      const id = this.pick(e);
      if (id !== this.hoverId) {
        this.hoverId = id;
        this.canvas.style.cursor = id ? 'grab' : 'default';
      }
      return;
    }
    const id = this.scene.getSelected();
    if (!id) return;
    const t = this.transforms.get(id);
    if (!t) return;
    const hit = this.intersectPlane(e);
    if (!hit) return;

    const nx = clampSafe(hit.x + this.dragOffset.x, OBJECT_LIMITS.minX, OBJECT_LIMITS.maxX, t.x);
    const ny = clampSafe(hit.y + this.dragOffset.y, OBJECT_LIMITS.minY, OBJECT_LIMITS.maxY, t.y);
    if (nx === t.x && ny === t.y) return;

    const next: Transform3D = { ...t, x: nx, y: ny };
    this.transforms.set(id, next);
    this.scene.updateTransform(id, next);
    this.cb.onChange(id, next);
  }

  private handlePointerUp(e: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.canvas.style.cursor = 'grab';
    this.canvas.releasePointerCapture?.(e.pointerId);
    this.cb.onCommit();
  }

  // ───────────────────────── 键盘 ─────────────────────────

  /** 旋转步长：按键默认 5°，按住 Shift 为 15° */
  static readonly ROTATE_STEP = 5;
  /** 方向键微调步长：默认 0.04（精修），按住 Shift 为 0.18（粗调） */
  private static readonly NUDGE_FINE = 0.04;
  private static readonly NUDGE_COARSE = 0.18;

  private handleKeyDown(e: KeyboardEvent): void {
    if (!this.enabled) return;
    const id = this.scene.getSelected();
    if (!id) return;
    const step = e.shiftKey ? InteractionController.ROTATE_STEP * 3 : InteractionController.ROTATE_STEP;
    if (e.key === 'q' || e.key === 'Q') {
      this.rotateSelected(-step);
      e.preventDefault();
    } else if (e.key === 'e' || e.key === 'E') {
      this.rotateSelected(step);
      e.preventDefault();
    } else if (e.key.startsWith('Arrow')) {
      const nudge = e.shiftKey
        ? InteractionController.NUDGE_COARSE
        : InteractionController.NUDGE_FINE;
      this.nudgeSelected(e.key, nudge);
      e.preventDefault();
    }
  }

  /** 方向键微调：拖动的补充手段，用于最后一点精确对齐 */
  nudgeSelected(key: string, step: number): void {
    const id = this.scene.getSelected();
    if (!id || !this.controls.move) return;
    const t = this.transforms.get(id);
    if (!t) return;
    let dx = 0;
    let dy = 0;
    if (key === 'ArrowLeft') dx = -step;
    else if (key === 'ArrowRight') dx = step;
    else if (key === 'ArrowUp') dy = step;
    else if (key === 'ArrowDown') dy = -step;
    else return;

    const next: Transform3D = {
      ...t,
      x: clampSafe(t.x + dx, OBJECT_LIMITS.minX, OBJECT_LIMITS.maxX, t.x),
      y: clampSafe(t.y + dy, OBJECT_LIMITS.minY, OBJECT_LIMITS.maxY, t.y),
    };
    this.transforms.set(id, next);
    this.scene.updateTransform(id, next);
    this.cb.onChange(id, next);
    this.cb.onCommit();
  }

  /** 旋转选中物体（步长 5° 或任意角度） */
  rotateSelected(delta: number): void {
    const id = this.scene.getSelected();
    if (!id || !this.controls.rotate) return;
    const t = this.transforms.get(id);
    if (!t) return;
    const next: Transform3D = { ...t, rotationZ: normalizeAngle(t.rotationZ + delta) };
    this.transforms.set(id, next);
    this.scene.updateTransform(id, next);
    this.cb.onChange(id, next);
    this.cb.onCommit();
  }

  /** 直接设置面内旋转角（滑杆使用），用于精细对角度 */
  setSelectedRotation(deg: number): void {
    const id = this.scene.getSelected();
    if (!id || !this.controls.rotate) return;
    const t = this.transforms.get(id);
    if (!t) return;
    const next: Transform3D = { ...t, rotationZ: normalizeAngle(clampSafe(deg, -180, 180, t.rotationZ)) };
    this.transforms.set(id, next);
    this.scene.updateTransform(id, next);
    this.cb.onChange(id, next);
    this.cb.onCommit();
  }

  /** 设置选中物体的翻转角（rotationY） */
  setSelectedFlip(deg: number): void {
    const id = this.scene.getSelected();
    if (!id || !this.controls.flip) return;
    const t = this.transforms.get(id);
    if (!t) return;
    const next: Transform3D = { ...t, rotationY: deg };
    this.transforms.set(id, next);
    this.scene.updateTransform(id, next);
    this.cb.onChange(id, next);
    this.cb.onCommit();
  }

  /** 设置选中物体的深度（物体与投影墙之间的距离） */
  setSelectedDepth(z: number): void {
    const id = this.scene.getSelected();
    if (!id || !this.controls.depth) return;
    const t = this.transforms.get(id);
    if (!t) return;
    const nz = clampSafe(z, OBJECT_LIMITS.minZ, OBJECT_LIMITS.maxZ, t.z);
    const next: Transform3D = { ...t, z: nz };
    this.transforms.set(id, next);
    this.scene.updateTransform(id, next);
    this.cb.onChange(id, next);
    this.cb.onCommit();
  }

  /** 直接写入某个物体的变换（供重置与关卡加载使用） */
  setTransform(id: string, t: Transform3D): void {
    this.transforms.set(id, { ...t });
    this.scene.updateTransform(id, t);
  }

  select(id: string | null): void {
    this.scene.setSelected(id);
    this.cb.onSelect(id);
  }

  dispose(): void {
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
  }
}

/** 把角度规范到 (-180, 180] */
export function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}
