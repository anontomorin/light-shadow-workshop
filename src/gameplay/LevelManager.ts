import { getObjectLocalVertices } from '../scene/GeometryFactory';
import { SilhouetteRasterizer } from '../projection/SilhouetteRasterizer';
import { clipPolygonToWall, projectParts, type Point2 } from '../projection/Projector';
import type { LevelDefinition, Transform3D } from './LevelData';
import type { LightState } from './LightController';

/**
 * 关卡运行时管理：加载关卡、维护当前变换与光源、生成目标掩码与当前掩码。
 *
 * 目标掩码在加载关卡时用"目标变换 + 目标光源"一次性生成并固定，
 * 不会随玩家操作而变化，否则玩家无法判断自己的调整是否接近目标。
 */
export class LevelManager {
  level: LevelDefinition | null = null;
  transforms = new Map<string, Transform3D>();
  light: LightState = { x: 0, y: 5.5, z: 14 };
  targetMask: Uint8Array = new Uint8Array(0);
  targetPolygons: Point2[][] = [];
  moves = 0;
  hintsUsed = 0;

  private rasterizer: SilhouetteRasterizer;

  constructor(rasterizer: SilhouetteRasterizer) {
    this.rasterizer = rasterizer;
  }

  load(level: LevelDefinition): void {
    this.level = level;
    this.transforms.clear();
    for (const obj of level.objects) {
      this.transforms.set(obj.id, { ...obj.initial });
    }
    this.light = { ...level.light.initial };
    this.moves = 0;
    this.hintsUsed = 0;

    // 目标掩码：由"目标变换 + 目标光源"生成，之后固定不变
    this.targetPolygons = this.computePolygons(
      level.objects.map((o) => o.target),
      level.light.target,
      level,
    );
    this.targetMask = this.rasterizer.rasterize(this.targetPolygons);
  }

  /** 恢复到关卡初始状态 */
  reset(): void {
    const level = this.level;
    if (!level) return;
    for (const obj of level.objects) {
      this.transforms.set(obj.id, { ...obj.initial });
    }
    this.light = { ...level.light.initial };
    this.moves = 0;
  }

  setTransform(id: string, t: Transform3D): void {
    this.transforms.set(id, { ...t });
  }

  setLight(s: LightState): void {
    this.light = { ...s };
  }

  /** 记录一次有效操作（用于结算评价，不影响通关） */
  countMove(): void {
    this.moves++;
  }

  /**
   * 计算当前投影多边形。
   * 使用与目标掩码完全相同的坐标映射与裁剪规则。
   */
  currentPolygons(): Point2[][] {
    if (!this.level) return [];
    const transforms = this.level.objects.map((o) => this.transforms.get(o.id) ?? o.initial);
    return this.computePolygons(transforms, this.light, this.level);
  }

  currentMask(): Uint8Array {
    return this.rasterizer.rasterize(this.currentPolygons());
  }

  /**
   * 计算当前投影多边形。
   * 使用与目标掩码完全相同的坐标映射与裁剪规则。
   *
   * 返回的是**扁平的多边形列表**：复合构件的每个凸零件各贡献一个多边形，
   * 由 `SilhouetteRasterizer.rasterize()` 取并集。这样构件内部与构件之间的
   * 镂空（花窗的格眼）才不会被填死。
   */
  private computePolygons(
    transforms: Transform3D[],
    light: { x: number; y: number; z: number },
    level: LevelDefinition,
  ): Point2[][] {
    const out: Point2[][] = [];
    level.objects.forEach((obj, i) => {
      const hulls = projectParts(
        getObjectLocalVertices(obj),
        transforms[i],
        light,
        obj.scale ?? 1,
      );
      for (const hull of hulls) {
        const clipped = clipPolygonToWall(hull);
        if (clipped.length >= 3) out.push(clipped);
      }
    });
    return out;
  }

  /** 最深的物体 z，用于约束光源最小距离 */
  maxObjectZ(): number {
    let m = 0;
    for (const t of this.transforms.values()) m = Math.max(m, t.z);
    return m;
  }
}
