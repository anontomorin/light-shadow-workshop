/**
 * 关卡与物体的数据类型定义。
 *
 * 坐标约定（全局统一，场景与投影计算共用）：
 *   X：投影墙水平方向，右为正；
 *   Y：垂直方向，上为正；
 *   Z：光源到投影墙之间的深度方向，投影墙位于 z = WALL_Z(0)，光源位于正 Z 方向。
 */

/** 支持的几何形状类型 */
export type ShapeType =
  | 'triangle'
  | 'square'
  | 'rectangle'
  | 'circle'
  | 'hexagon'
  | 'diamond';

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
  /** 几何形状 */
  shape: ShapeType;
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
