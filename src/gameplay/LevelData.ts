/**
 * 关卡与物体的数据类型定义。
 *
 * 坐标约定（全局统一，场景与投影计算共用）：
 *   X：投影墙水平方向，右为正；
 *   Y：垂直方向，上为正；
 *   Z：光源到投影墙之间的深度方向，投影墙位于 z = WALL_Z(0)，光源位于正 Z 方向。
 */

/**
 * 支持的几何形状类型。
 *
 * 前 6 种是原有形状；后 8 种是本轮新增：
 *   五边形 / 八边形 / 梯形 / 扇形 —— 凸形，单个零件即可精确投影；
 *   十字 / 五角星 / 圆环    —— 凹形，会被拆成若干**凸零件**分别投影后取并集，
 *                              因此凹口与中空不会被凸包填死（见 GeometryFactory）；
 *   棂条                    —— 1×1 基准方条，通过 sx / sy 拉成任意比例的窗棂杆件，
 *                              用于拼装"花窗构件"，是新增花窗关卡的基本素材。
 */
export type ShapeType =
  | 'triangle'
  | 'square'
  | 'rectangle'
  | 'circle'
  | 'hexagon'
  | 'diamond'
  | 'pentagon'
  | 'octagon'
  | 'trapezoid'
  | 'semicircle'
  | 'cross'
  | 'star'
  | 'ring'
  | 'slat';

/**
 * 复合构件的一个零件：以某个基础形状为胚子，做缩放 / 面内旋转 / 平移。
 *
 * 关键点：零件必须**自身凸**。投影时对每个零件单独求凸包，再把所有零件的
 * 多边形交给 `SilhouetteRasterizer` 做并集 —— 这样"十字的凹口""圆环的中空"
 * 这类镂空才不会被整块凸包填死。
 *
 * 缩放用 `w` / `h`（**目标宽高，单位为物体局部单位**），而不是缩放系数：
 * 写构件时可以像画图纸一样直接标尺寸。基准宽高由 GeometryFactory 依据胚子
 * 轮廓给出（回转对称形状取外接圆直径，其余取包围盒；棂条基准为 1×1，
 * 故 w / h 就是实际长宽）。省略时沿用胚子的基准尺寸；只给一轴时另一轴等比跟随。
 */
export interface ShapePart {
  /** 胚子形状 */
  shape: ShapeType;
  /** 面内平移（物体局部坐标） */
  dx?: number;
  dy?: number;
  /** 面内旋转（度，绕该零件自身中心） */
  rot?: number;
  /** 目标宽度 */
  w?: number;
  /** 目标高度 */
  h?: number;
}

/** 物体的三维变换（位置单位：世界单位；旋转单位：度） */
export interface Transform3D {
  x: number;
  y: number;
  z: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
}

/** 关卡中一个可投影物体的定义 */
export interface ShadowObjectDefinition {
  /** 物体唯一标识 */
  id: string;
  /** 物体在界面上显示的名字 */
  name: string;
  /** 几何形状（省略 parts 时，该形状自身就是整个物体） */
  shape: ShapeType;
  /**
   * 复合构件的零件列表（可选）。
   * 给出时以 parts 为准，`shape` 只作为回落与图标提示使用 —— 花窗关卡里的
   * "外框""十字棂""菱花心"都是这样一组零件，玩家拖动的是整个构件。
   */
  parts?: ShapePart[];
  /** 物体自身颜色（仅用于区分物体，影子统一为深蓝灰） */
  color: string;
  /** 统一缩放系数，用于在同一形状下得到不同尺寸（可选，默认 1） */
  scale?: number;
  /** 关卡开始时的变换 */
  initial: Transform3D;
  /** 生成目标轮廓所使用的变换 */
  target: Transform3D;
}

/** 光源定义（初始与目标） */
export interface LightDefinition {
  initial: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
}

/** 每一关允许玩家操作的维度，用于循序渐进地教学 */
export interface LevelControls {
  /** 是否允许拖动改变 x / y */
  move: boolean;
  /** 是否允许旋转（rotationZ） */
  rotate: boolean;
  /** 是否允许翻转（rotationY） */
  flip: boolean;
  /** 是否允许调整物体深度 z */
  depth: boolean;
  /** 是否显示光源控制面板 */
  light: boolean;
  /** 光源面板中是否开放“光源距离”滑杆 */
  lightDistance: boolean;
}

export interface LevelDefinition {
  id: number;
  title: string;
  /** 一句话目标说明 */
  description: string;
  /** 关卡开始前的操作引导 */
  tutorial?: string;
  objects: ShadowObjectDefinition[];
  light: LightDefinition;
  /** 通关所需的最低 IoU */
  matchThreshold: number;
  /** 获得“优秀”所需的 IoU */
  excellentThreshold: number;
  /** 获得“大师”所需的 IoU */
  masterThreshold: number;
  /** 循序渐进的提示文本 */
  hintSteps: string[];
  /** 建议操作次数（用于“大师”评价） */
  recommendedMoves: number;
  /** 本关开放的操作维度 */
  controls: LevelControls;
}

/** 单关的存档记录 */
export interface LevelRecord {
  cleared: boolean;
  bestIou: number;
  bestRank: 'none' | 'complete' | 'excellent' | 'master';
  bestMoves: number;
  hintsUsed: number;
}

/** 完整的本地存档结构 */
export interface SaveData {
  version: number;
  unlocked: number;
  levels: Record<number, LevelRecord>;
  soundEnabled: boolean;
  /** 是否已完成过全部关卡（用于解锁自由实验室） */
  labUnlocked: boolean;
}
