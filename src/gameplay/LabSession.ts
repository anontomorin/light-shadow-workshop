import { getObjectLocalVertices } from '../scene/GeometryFactory';
import { clipPolygonToWall, projectParts, type Point2 } from '../projection/Projector';
import type { ShadowObjectDefinition, ShapeType, Transform3D } from './LevelData';
import type { LightState } from './LightController';

/**
 * 自由实验室的会话状态：只维护"有哪些物体、各自在哪、光源在哪"，
 * 不涉及目标轮廓、匹配度或通关判定。
 *
 * 物体添加 / 删除后会整体重建场景（物体数量很少，重建成本可忽略），
 * 拖动与旋转则走与正式关卡完全相同的交互链路。
 */

export const LAB_CONTROLS = {
  move: true,
  rotate: true,
  flip: true,
  depth: true,
  light: true,
  lightDistance: true,
};

/** 可添加的形状与配色（按添加顺序循环取色） */
export const LAB_SHAPES: Array<{ shape: ShapeType; name: string; color: string }> = [
  { shape: 'square', name: '方块', color: '#e8a33d' },
  { shape: 'circle', name: '圆盘', color: '#4aa3c7' },
  { shape: 'triangle', name: '三角', color: '#8fbf6a' },
  { shape: 'rectangle', name: '长方', color: '#b4753f' },
  { shape: 'hexagon', name: '六边', color: '#7b9fd6' },
  { shape: 'diamond', name: '菱形', color: '#b98bd6' },
  { shape: 'pentagon', name: '五边', color: '#d08a4a' },
  { shape: 'octagon', name: '八边', color: '#5fa8a0' },
  { shape: 'trapezoid', name: '梯形', color: '#c2703f' },
  { shape: 'semicircle', name: '半圆', color: '#8fa9dc' },
  { shape: 'cross', name: '十字', color: '#c2452d' },
  { shape: 'star', name: '星形', color: '#d9a72c' },
  { shape: 'ring', name: '圆环', color: '#2f6b57' },
];

/** 自由实验室最多容纳的物体数量（保持性能与画面整洁） */
export const LAB_MAX_OBJECTS = 10;

/** 场景重置时的默认摆位 */
const INITIAL_LAYOUT: Array<{ shape: ShapeType; name: string; color: string; transform: Transform3D }> = [
  {
    shape: 'square',
    name: '方块',
    color: '#e8a33d',
    transform: { x: -3.8, y: 4.4, z: 3.0, rotationX: 0, rotationY: 0, rotationZ: 0 },
  },
  {
    shape: 'circle',
    name: '圆盘',
    color: '#4aa3c7',
    transform: { x: 0.2, y: 6.4, z: 3.6, rotationX: 0, rotationY: 0, rotationZ: 0 },
  },
  {
    shape: 'triangle',
    name: '三角',
    color: '#8fbf6a',
    transform: { x: 4.0, y: 3.8, z: 3.0, rotationX: 0, rotationY: 0, rotationZ: 0 },
  },
];

export const LAB_DEFAULT_LIGHT: LightState = { x: 0, y: 5.5, z: 14 };

export class LabSession {
  objects: ShadowObjectDefinition[] = [];
  transforms = new Map<string, Transform3D>();
  light: LightState = { ...LAB_DEFAULT_LIGHT };
  selectedId: string | null = null;

  private seq = 0;

  /** 恢复到默认场景 */
  reset(): void {
    this.seq = 0;
    this.objects = [];
    this.transforms.clear();
    for (const item of INITIAL_LAYOUT) {
      const id = `lab${++this.seq}`;
      this.objects.push({
        id,
        name: item.name,
        shape: item.shape,
        color: item.color,
        initial: { ...item.transform },
        target: { ...item.transform },
      });
      this.transforms.set(id, { ...item.transform });
    }
    this.light = { ...LAB_DEFAULT_LIGHT };
    this.selectedId = this.objects[0]?.id ?? null;
  }

  get count(): number {
    return this.objects.length;
  }

  defOf(id: string): ShadowObjectDefinition | null {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  /** 添加一个形状，放在墙面左侧偏上的空位，返回新物体（达到上限则返回 null） */
  add(shape: ShapeType): ShadowObjectDefinition | null {
    if (this.objects.length >= LAB_MAX_OBJECTS) return null;
    const preset = LAB_SHAPES.find((s) => s.shape === shape) ?? LAB_SHAPES[0];
    const id = `lab${++this.seq}`;
    // 新物体沿 -X 方向依次排开，避免与已有物体完全重叠
    const slot = this.objects.length;
    const transform: Transform3D = {
      x: -5.5 + (slot % 5) * 2.6,
      y: 8.2 - Math.floor(slot / 5) * 3.4,
      z: 3.4,
      rotationX: 0,
      rotationY: 0,
      rotationZ: 0,
    };
    const def: ShadowObjectDefinition = {
      id,
      name: preset.name,
      shape,
      color: preset.color,
      initial: { ...transform },
      target: { ...transform },
    };
    this.objects.push(def);
    this.transforms.set(id, { ...transform });
    return def;
  }

  remove(id: string): boolean {
    const idx = this.objects.findIndex((o) => o.id === id);
    if (idx < 0) return false;
    this.objects.splice(idx, 1);
    this.transforms.delete(id);
    if (this.selectedId === id) this.selectedId = this.objects[Math.min(idx, this.objects.length - 1)]?.id ?? null;
    return true;
  }

  setTransform(id: string, t: Transform3D): void {
    this.transforms.set(id, { ...t });
  }

  /**
   * 当前所有物体的投影轮廓（与正式关卡共用同一套投影与裁剪规则）。
   * 复合构件的每个凸零件各贡献一个多边形，由光栅化阶段取并集。
   */
  polygons(): Point2[][] {
    const out: Point2[][] = [];
    for (const obj of this.objects) {
      const t = this.transforms.get(obj.id) ?? obj.initial;
      const hulls = projectParts(
        getObjectLocalVertices(obj),
        t,
        this.light,
        obj.scale ?? 1,
      );
      for (const hull of hulls) {
        const clipped = clipPolygonToWall(hull);
        if (clipped.length >= 3) out.push(clipped);
      }
    }
    return out;
  }

  maxObjectZ(): number {
    let m = 0;
    for (const t of this.transforms.values()) m = Math.max(m, t.z);
    return m;
  }
}
