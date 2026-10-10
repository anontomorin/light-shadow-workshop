import * as THREE from 'three';
import { WALL_Z, type Point2 } from '../projection/Projector';

/**
 * 把投影多边形渲染到投影墙上。
 *
 * 关键约束：当前影子与目标轮廓使用完全相同的墙面坐标映射，
 * 因此玩家在屏幕上看到的位置关系与 IoU 判定结果必然一致。
 *
 * 重叠处理（重要）：
 *   墙上每个多边形都是**半透明**的，如果逐个叠加，重叠处会因为 alpha 复合而
 *   明显变深，出现一圈"补丁"般的接缝。这里改成 **模板缓冲并集填充**：
 *   先把前景（当前影子 / 目标填充）的多边形只写模板缓冲、不写颜色不写深度，
 *   再把一个与墙面等大的矩形按模板测试铺上颜色。
 *   于是无论多少个多边形重叠，整块并集区域都只被填充**一次**，
 *   颜色完全均匀，看不出任何重叠痕迹。
 *
 * 层次顺序（z 越大越靠前）：
 *   目标填充 WALL_Z + 0.01 → 目标描边 WALL_Z + 0.02 → 当前影子 WALL_Z + 0.04
 *
 * 影子刻意放在**最上层**：它代表玩家此刻的实际成果，压住示例图形后
 * 玩家看到的形状就是自己摆出来的结果。示例的淡填充与轮廓线都在影子之下，
 * 因此影子边缘与目标轮廓的重合程度才是判断"贴没贴合"的依据。
 */

const Z_TARGET_FILL = WALL_Z + 0.01;
const Z_TARGET_STROKE = WALL_Z + 0.02;
const Z_SHADOW = WALL_Z + 0.04;

/** 单次绘制需要 2 个模板位（0 基准一个、1 基准一个），用位掩码彼此隔离 */
const GROUP_TARGET_FILL = 1;
const GROUP_SHADOW = 2;

const COLOR_SHADOW = 0x31455a;
const COLOR_TARGET_FILL = 0x2f8fa8;
const COLOR_TARGET_STROKE = 0x1f7f96;

/**
 * 铺满整个墙面的矩形。它必须比墙面**略小**：
 * 矩形与墙面共面且同为 DoubleSide 时会互相闪烁，
 * 而任意方向略微内缩都不会影响观感（溢出部分本来就被裁掉了）。
 */
const FILL_INSET = 0.05;

function buildWallSizedPlane(z: number): THREE.BufferGeometry {
  const geo = new THREE.PlaneGeometry(
    WALL_SIZE.x - FILL_INSET * 2,
    WALL_SIZE.y - FILL_INSET * 2,
  );
  geo.translate(WALL_CENTER.x, WALL_CENTER.y, z);
  return geo;
}

const WALL_SIZE = { x: 18, y: 10 };
const WALL_CENTER = { x: 0, y: 5.5 };

export class ProjectionRenderer {
  readonly group = new THREE.Group();

  private shadowGroup = new THREE.Group();
  private targetFillGroup = new THREE.Group();
  private targetStrokeGroup = new THREE.Group();

  private shadowMaterial: THREE.MeshBasicMaterial;
  private targetFillMaterial: THREE.MeshBasicMaterial;
  private targetStrokeMaterial: THREE.LineBasicMaterial;

  /** 只写模板、不写颜色：把该组的形状"烙"进模板缓冲 */
  private shadowStampMaterial: THREE.MeshBasicMaterial;
  private targetFillStampMaterial: THREE.MeshBasicMaterial;

  /** 按模板测试把并集区域一次性铺色 */
  private shadowFill: THREE.Mesh;
  private targetFill: THREE.Mesh;

  private shadowFillGeometry: THREE.BufferGeometry;
  private targetFillGeometry: THREE.BufferGeometry;

  private highlight = 0;

  constructor() {
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR_SHADOW),
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      // 只有模板缓冲被"烙"过的像素（即并集区域）才会被填充
      stencilWrite: true,
      stencilFunc: THREE.EqualStencilFunc,
      stencilRef: GROUP_SHADOW,
      stencilFuncMask: GROUP_SHADOW,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    this.targetFillMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(COLOR_TARGET_FILL),
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilFunc: THREE.EqualStencilFunc,
      stencilRef: GROUP_TARGET_FILL,
      stencilFuncMask: GROUP_TARGET_FILL,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });

    // 写模板但不写颜色，也不写深度 —— 纯"形状印章"
    const stampCommon = {
      colorWrite: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilFunc: THREE.AlwaysStencilFunc,
      // ReplaceStencilOp 在 stencilZPass 生效；同时覆盖 zFail 以防被深度判定拦下
      stencilZPass: THREE.ReplaceStencilOp,
      stencilZFail: THREE.ReplaceStencilOp,
      stencilFail: THREE.ReplaceStencilOp,
    } as const;
    this.shadowStampMaterial = new THREE.MeshBasicMaterial({
      ...stampCommon,
      stencilRef: GROUP_SHADOW,
    });
    this.targetFillStampMaterial = new THREE.MeshBasicMaterial({
      ...stampCommon,
      stencilRef: GROUP_TARGET_FILL,
    });

    this.targetStrokeMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(COLOR_TARGET_STROKE),
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });

    this.targetFillGeometry = buildWallSizedPlane(Z_TARGET_FILL);
    this.shadowFillGeometry = buildWallSizedPlane(Z_SHADOW);
    this.targetFill = new THREE.Mesh(this.targetFillGeometry, this.targetFillMaterial);
    this.shadowFill = new THREE.Mesh(this.shadowFillGeometry, this.shadowMaterial);

    // 加入顺序 = 绘制顺序（同 depth 下按序覆盖），最终以 z 值决定前后：
    // 目标填充 → 目标描边 → 影子，影子在最上层
    this.group.add(
      this.targetFillGroup,
      this.targetFill,
      this.targetStrokeGroup,
      this.shadowGroup,
      this.shadowFill,
    );
  }

  /**
   * 更新当前影子。
   * 多个物体的影子重叠时会被合并为一块均匀的实心区域（模板并集）。
   */
  setCurrent(polygons: Point2[][]): void {
    this.rebuildShapes(this.shadowGroup, polygons, Z_SHADOW, this.shadowStampMaterial);
  }

  /** 更新目标轮廓（淡填充 + 描边，固定在墙上，不随玩家操作变化） */
  setTarget(polygons: Point2[][]): void {
    this.rebuildShapes(this.targetFillGroup, polygons, Z_TARGET_FILL, this.targetFillStampMaterial);
    this.rebuildStroke(this.targetStrokeGroup, polygons, Z_TARGET_STROKE);
  }

  /** 用同一个材质重建一组多边形（材质由调用方提供，以便共用模板印章材质） */
  private rebuildShapes(
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

  /** 当前影子在墙面上的图元数量（供自动化测试确认影子确实被绘制） */
  shadowMeshCount(): number {
    return this.shadowGroup.children.length;
  }

  /**
   * 图层层级快照（供自动化测试断言"影子画在示例图形之上"）。
   * z 越大越靠前；同 z 时按加入顺序后来者居上。
   */
  layerOrder(): { targetFill: number; targetStroke: number; shadow: number; shadowIsTop: boolean } {
    const shadowGroupZ = Z_SHADOW;
    const order = this.group.children.map((c) => c);
    const indexOf = (obj: THREE.Object3D) => order.indexOf(obj);
    const shadowFillIdx = indexOf(this.shadowFill);
    const strokeIdx = indexOf(this.targetStrokeGroup);
    const fillIdx = indexOf(this.targetFill);
    return {
      targetFill: fillIdx,
      targetStroke: strokeIdx,
      shadow: shadowFillIdx,
      // 影子既在绘制顺序上最后，z 值也最大，才会真正盖住示例
      shadowIsTop:
        shadowFillIdx > strokeIdx &&
        shadowFillIdx > fillIdx &&
        shadowGroupZ > Z_TARGET_STROKE &&
        Z_TARGET_STROKE > Z_TARGET_FILL,
    };
  }

  update(dt: number): void {
    if (this.highlight > 0) {
      this.highlight = Math.max(0, this.highlight - dt);
      const k = Math.sin((this.highlight / 1.1) * Math.PI);
      this.targetStrokeMaterial.opacity = 0.7 + k * 0.3;
      this.targetFillMaterial.opacity = 0.16 + k * 0.3;
      this.shadowMaterial.color.setHex(k > 0.01 ? 0x3f6d84 : COLOR_SHADOW);
    } else if (this.targetStrokeMaterial.opacity !== 0.7) {
      this.targetStrokeMaterial.opacity = 0.7;
      this.targetFillMaterial.opacity = 0.16;
      this.shadowMaterial.color.setHex(COLOR_SHADOW);
    }
  }

  dispose(): void {
    disposeChildren(this.shadowGroup);
    disposeChildren(this.targetFillGroup);
    disposeChildren(this.targetStrokeGroup);
    this.shadowFillGeometry.dispose();
    this.targetFillGeometry.dispose();
    this.shadowMaterial.dispose();
    this.targetFillMaterial.dispose();
    this.targetStrokeMaterial.dispose();
    this.shadowStampMaterial.dispose();
    this.targetFillStampMaterial.dispose();
  }
}

function disposeChildren(group: THREE.Group): void {
  for (const child of group.children.slice()) {
    group.remove(child);
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  }
}
