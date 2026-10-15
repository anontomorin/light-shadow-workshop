import { generatePatternStrokes, patternDisplayName } from '../patterns/PatternRegistry';
import { dedupePoints, segmentCount } from '../patterns/geometry';
import type {
  LatticeRole,
  LatticeStroke,
  PatternKind,
  PatternParameters,
  Vec2Data,
  WindowDocument,
} from '../patterns/types';
import {
  COMPLEXITY_LIMITS,
  DEFAULT_PARAMETERS,
  WINDOW_LIMITS,
  clampPatternParameters,
  inspectComplexity,
  type ComplexityReport,
} from './GeometryLimits';

/**
 * 窗格文档：编辑器状态与存档的唯一数据源。
 *
 * 这里集中处理三件事：
 *   1. 从模板参数生成文档（buildDocumentFromPattern）；
 *   2. 校验 / 修复任何外部来源的文档（validateWindowDocument），
 *      保证不含 NaN / 负宽度 / 退化线段；
 *   3. 统计构件（按角色分类），供界面展示"窗框 / 窗心棂条 / 边饰"的数量。
 */

let docSeq = 0;

/** 生成文档 id（时间戳 + 自增序号，足够稳定且不依赖随机数） */
function newId(): string {
  docSeq += 1;
  return `win-${Date.now().toString(36)}-${docSeq.toString(36)}`;
}

export interface DocumentBuildOptions {
  patternId: PatternKind;
  parameters?: Partial<PatternParameters>;
  name?: string;
  /** 复用的已有文档 id（另存为时传入） */
  id?: string;
  createdAt?: string;
  author?: string;
  /** 以用户自绘笔画作为主体（patternId 会被置为 custom） */
  userStrokes?: LatticeStroke[];
}

/**
 * 从模板参数构建一份完整的窗格文档。
 * 传入 userStrokes 时，模板笔画会被丢弃，只保留外框 + 用户笔画。
 */
export function buildDocumentFromPattern(opts: DocumentBuildOptions): WindowDocument {
  const params = clampPatternParameters(opts.parameters ?? DEFAULT_PARAMETERS);
  const now = new Date().toISOString();
  const userStrokes = opts.userStrokes ? normalizeStrokes(opts.userStrokes) : null;

  let patternId: PatternKind = opts.patternId;
  let strokes: LatticeStroke[];
  if (userStrokes) {
    const generated = generatePatternStrokes('blank', params);
    patternId = 'custom';
    strokes = [...generated.strokes, ...userStrokes];
  } else {
    strokes = generatePatternStrokes(patternId, params).strokes;
  }

  return {
    schemaVersion: 1,
    id: opts.id ?? newId(),
    name: opts.name ?? patternDisplayName(patternId),
    patternId,
    width: params.width,
    height: params.height,
    frameWidth: params.frameWidth,
    depth: 0.32,
    barWidth: params.barWidth,
    strokes,
    parameters: params,
    createdAt: opts.createdAt ?? now,
    updatedAt: now,
    author: opts.author,
    isUserCreation: patternId === 'custom',
  };
}

/** 只重新生成本模板的笔画（保留用户笔画与元信息），用于参数实时重建 */
export function regenerateDocument(
  doc: WindowDocument,
  nextParams: Partial<PatternParameters>,
): WindowDocument {
  const params = clampPatternParameters({ ...doc.parameters, ...nextParams });
  const userStrokes = doc.strokes.filter((s) => s.source === 'user');

  // 参数变化会改变窗格尺寸，用户笔画要跟着等比缩放，否则会跑到框外
  const sx = params.width / doc.width;
  const sy = params.height / doc.height;
  const scaledUser = userStrokes.map((s) => ({
    ...s,
    points: s.points.map((p) => ({ x: p.x * sx, y: p.y * sy })),
  }));

  const isCustom = doc.patternId === 'custom';
  const generated = generatePatternStrokes(isCustom ? 'blank' : doc.patternId, params);

  return {
    ...doc,
    width: params.width,
    height: params.height,
    frameWidth: params.frameWidth,
    barWidth: params.barWidth,
    parameters: params,
    strokes: [...generated.strokes, ...normalizeStrokes(scaledUser)],
    updatedAt: new Date().toISOString(),
  };
}

/** 清空窗心：保留外框，移除所有窗心与边饰笔画 */
export function clearDraft(doc: WindowDocument): WindowDocument {
  const frame = doc.strokes.filter((s) => s.role === 'frame');
  return {
    ...doc,
    patternId: 'blank',
    strokes: frame,
    isUserCreation: false,
    updatedAt: new Date().toISOString(),
  };
}

// ───────────────────────── 校验与修复 ─────────────────────────

const VALID_ROLES: LatticeRole[] = ['frame', 'lattice', 'border'];

/** 把任意笔画数组清洗为合法数据：去重、夹紧宽度、拒绝退化线段 */
export function normalizeStrokes(input: LatticeStroke[]): LatticeStroke[] {
  const out: LatticeStroke[] = [];
  let i = 0;
  for (const s of input) {
    if (!s || !Array.isArray(s.points)) continue;
    const pts = dedupePoints(s.points as Vec2Data[]);
    if (pts.length < 2) continue;
    const width = Number.isFinite(s.width)
      ? Math.min(WINDOW_LIMITS.maxBarWidth, Math.max(WINDOW_LIMITS.minBarWidth * 0.5, s.width))
      : 0.08;
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : `s${i}`,
      points: pts,
      width,
      role: VALID_ROLES.includes(s.role) ? s.role : 'lattice',
      source: s.source === 'user' ? 'user' : 'template',
    });
    i++;
  }
  return out;
}

export interface ValidationResult {
  doc: WindowDocument;
  /** 是否对输入做过修复 */
  repaired: boolean;
  /** 无法修复、只能丢弃的原因 */
  reason?: string;
}

const NUM_KEYS = ['width', 'height', 'frameWidth', 'barWidth', 'depth'] as const;

/**
 * 校验外部 JSON（存档 / 导入）并返回可安全使用的文档。
 * 任何字段非法都会被夹紧或回退到默认值，绝不把 NaN 带进几何管线。
 */
export function validateWindowDocument(raw: unknown): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { doc: fallbackDocument(), repaired: true, reason: '数据不是对象' };
  }
  const r = raw as Partial<WindowDocument>;
  if (r.schemaVersion !== 1) {
    return { doc: fallbackDocument(), repaired: true, reason: 'schemaVersion 不匹配' };
  }

  let repaired = false;
  const numeric = (key: (typeof NUM_KEYS)[number], fallback: number) => {
    const v = r[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    repaired = true;
    return fallback;
  };

  const params = clampPatternParameters({
    ...(r.parameters ?? {}),
    width: numeric('width', DEFAULT_PARAMETERS.width!),
    height: numeric('height', DEFAULT_PARAMETERS.height!),
    frameWidth: numeric('frameWidth', DEFAULT_PARAMETERS.frameWidth!),
    barWidth: numeric('barWidth', DEFAULT_PARAMETERS.barWidth!),
  });
  if (
    params.width !== r.width ||
    params.height !== r.height ||
    params.frameWidth !== r.frameWidth ||
    params.barWidth !== r.barWidth
  ) {
    repaired = true;
  }

  const rawStrokes = Array.isArray(r.strokes) ? (r.strokes as LatticeStroke[]) : [];
  const strokes = normalizeStrokes(rawStrokes);
  if (strokes.length !== rawStrokes.length) repaired = true;

  const patternId: PatternKind =
    typeof r.patternId === 'string' ? (r.patternId as PatternKind) : 'blank';

  return {
    doc: {
      schemaVersion: 1,
      id: typeof r.id === 'string' && r.id ? r.id : newId(),
      name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : '未命名作品',
      patternId,
      width: params.width,
      height: params.height,
      frameWidth: params.frameWidth,
      depth: Math.min(
        WINDOW_LIMITS.maxDepth,
        Math.max(WINDOW_LIMITS.minDepth, numeric('depth', 0.32)),
      ),
      barWidth: params.barWidth,
      strokes,
      parameters: params,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
      updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
      author: typeof r.author === 'string' ? r.author.slice(0, 24) : undefined,
      isUserCreation: r.isUserCreation === true || patternId === 'custom',
    },
    repaired,
  };
}

export function fallbackDocument(): WindowDocument {
  const doc = buildDocumentFromPattern({ patternId: 'blank' });
  return { ...doc, name: '恢复的窗格' };
}

/** 深拷贝（纯数据，structuredClone 在旧浏览器不可用时退回 JSON） */
export function cloneDocument(doc: WindowDocument): WindowDocument {
  if (typeof structuredClone === 'function') return structuredClone(doc);
  return JSON.parse(JSON.stringify(doc)) as WindowDocument;
}

// ───────────────────────── 构件统计 ─────────────────────────

export interface StrokeStats {
  frame: number;
  lattice: number;
  border: number;
  user: number;
  total: number;
  segments: number;
  complexity: ComplexityReport;
}

export function strokeStats(doc: WindowDocument): StrokeStats {
  const stats: StrokeStats = {
    frame: 0,
    lattice: 0,
    border: 0,
    user: 0,
    total: doc.strokes.length,
    segments: 0,
    complexity: inspectComplexity(doc.strokes),
  };
  for (const s of doc.strokes) {
    stats[s.role] += 1;
    if (s.source === 'user') stats.user += 1;
    stats.segments += segmentCount(s.points);
  }
  return stats;
}

export { COMPLEXITY_LIMITS };
