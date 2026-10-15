/**
 * 纹样与窗格的数据模型。
 *
 * 核心约束（开发文档 5.3）：编辑器状态与 Three.js 实例分离，
 * 存档只保存纯 JSON 友好的数据 —— 不保存 Mesh / 材质 / 张量对象。
 *
 * 长度单位统一使用项目的世界单位（与投影墙、关卡物体一致），
 * 角度单位统一为「度」。
 */

/** 纹样类型。自定义 = 用户自绘或空白起步 */
export type PatternKind =
  | 'step-step-brocade'
  | 'ice-crack-style'
  | 'three-cross-six-bowl-diamond'
  | 'huiwen-border'
  | 'blank'
  | 'custom';

/** 二维点（纯数据） */
export interface Vec2Data {
  x: number;
  y: number;
}

/** 杆件在窗格中的角色：外框 / 窗心棂条 / 边框装饰 */
export type LatticeRole = 'frame' | 'lattice' | 'border';

/**
 * 一条棂条（折线）。每一段会各自生成一根有宽度与厚度的杆件。
 * 坐标位于窗格局部坐标系：原点在窗格中心，X 右为正，Y 上为正。
 */
export interface LatticeStroke {
  /** 稳定 ID（同一文档内唯一），用于选中、高亮与删除 */
  id: string;
  points: Vec2Data[];
  /** 棂条在窗格平面内的宽度 */
  width: number;
  role: LatticeRole;
  source: 'template' | 'user';
}

/** 生成器参数（可复现：同样的参数 + seed 必定得到同样的 strokes） */
export interface PatternParameters {
  /** 窗格总宽（世界单位） */
  width: number;
  /** 窗格总高（世界单位） */
  height: number;
  /** 外框的宽度（在平面内） */
  frameWidth: number;
  /** 窗心棂条宽度 */
  barWidth: number;
  /** 行数（步步锦 / 三交六椀） */
  rowCount?: number;
  /** 列数 */
  columnCount?: number;
  /** 随机种子（冰裂纹） */
  seed?: number;
  /** 密度 0~1（冰裂纹：保留内部线段的比例） */
  density?: number;
  /** 构图变体标识（如步步锦的 'plain' 纯格网） */
  variant?: string;
  /** 是否叠加回纹边饰（辅助装饰模块） */
  borderEnabled?: boolean;
  /** 回纹每边重复的单元数 */
  borderRepeat?: number;
}

/** 生成器的输出 */
export interface GeneratedPattern {
  strokes: LatticeStroke[];
  label: string;
  modelNote: string;
}

export interface PatternDefinition {
  id: PatternKind;
  displayName: string;
  shortDescription: string;
  constructionNote: string;
  sourceIds: string[];
  /**
   * 该模板的形态是否有可追溯的传统资料依据。
   * 注意：这不表示参数化几何已被证明为精确复原，具体说明仍看 modelNote。
   */
  isHistoricalReference: boolean;
  /** 是否为简化/示意性数字模型（界面需明确标注） */
  isSimplifiedDigitalModel: boolean;
}

export interface PatternGenerator {
  readonly id: PatternKind;
  generate(parameters: PatternParameters): GeneratedPattern;
}

/**
 * 窗格文档：编辑器与存档的唯一数据源。
 * 不包含任何 Three.js 对象，可直接 JSON 序列化。
 */
export interface WindowDocument {
  schemaVersion: 1;
  id: string;
  name: string;
  patternId: PatternKind;
  /** 窗格总宽（世界单位） */
  width: number;
  /** 窗格总高（世界单位） */
  height: number;
  /** 外框宽度 */
  frameWidth: number;
  /** 窗格厚度（Z 方向） */
  depth: number;
  /** 窗心棂条默认宽度 */
  barWidth: number;
  strokes: LatticeStroke[];
  /** 生成参数快照（便于恢复模板与展示创作参数） */
  parameters: PatternParameters;
  createdAt: string;
  updatedAt: string;
  author?: string;
  /** 自绘 / 空白起步的文档标记为用户创作 */
  isUserCreation?: boolean;
}
