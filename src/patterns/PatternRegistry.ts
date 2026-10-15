import { CULTURE_CARDS } from '../culture/patternCatalog';
import { clampPatternParameters } from '../window-builder/GeometryLimits';
import { frameStrokes } from './common';
import { HuiwenBorder, buildHuiwenStrokes } from './HuiwenBorder';
import { IceCrackPattern } from './IceCrackPattern';
import { LiuwanLinghuaPattern } from './LiuwanLinghuaPattern';
import { StepStepPattern } from './StepStepPattern';
import type {
  GeneratedPattern,
  LatticeStroke,
  PatternDefinition,
  PatternGenerator,
  PatternKind,
  PatternParameters,
} from './types';

/**
 * 纹样注册表：模板元数据 + 生成器 + 统一的"带装饰层"生成入口。
 *
 * 所有生成器都是纯函数式的：相同参数（含 seed）必定得到相同 strokes，
 * 不触碰 DOM，也不改写任何 UI 状态，因此可以直接在 Node 里做单元测试。
 */

/** 只有外框的空白窗格（自绘 / 从零搭建的起点） */
class BlankPattern implements PatternGenerator {
  readonly id = 'blank' as const;
  generate(raw: PatternParameters): GeneratedPattern {
    const p = clampPatternParameters(raw);
    return {
      strokes: frameStrokes(p),
      label: '空白窗格 · 仅外框',
      modelNote: '空白窗格不含任何传统纹样构件，窗心留待用户自行绘制。',
    };
  }
}

const GENERATORS: Record<PatternKind, PatternGenerator> = {
  'step-step-brocade': new StepStepPattern(),
  'ice-crack-style': new IceCrackPattern(),
  'three-cross-six-bowl-diamond': new LiuwanLinghuaPattern(),
  'huiwen-border': new HuiwenBorder(),
  blank: new BlankPattern(),
  // 自定义（自绘）以空白窗格为底，再由用户笔画叠加
  custom: new BlankPattern(),
};

const defOf = (id: string): PatternDefinition | null => {
  const card = CULTURE_CARDS.find((c) => c.patternId === id);
  if (!card) return null;
  return {
    id: id as PatternKind,
    displayName: card.title,
    shortDescription: card.formDescription,
    constructionNote: card.constructionNote,
    sourceIds: card.sourceIds,
    isHistoricalReference:
      id === 'step-step-brocade' ||
      id === 'ice-crack-style' ||
      id === 'three-cross-six-bowl-diamond',
    isSimplifiedDigitalModel: !card.modelNote.startsWith('这是用户自绘'),
  };
};

export const PATTERN_ORDER: PatternKind[] = [
  'step-step-brocade',
  'ice-crack-style',
  'three-cross-six-bowl-diamond',
  'huiwen-border',
  'blank',
];

export const PATTERN_DEFINITIONS: PatternDefinition[] = PATTERN_ORDER.map((id) => defOf(id)).filter(
  (d): d is PatternDefinition => d !== null,
);

export function getPatternDefinition(id: PatternKind): PatternDefinition | null {
  return defOf(id);
}

export function patternDisplayName(id: PatternKind): string {
  return defOf(id)?.displayName ?? '用户创作';
}

/**
 * 生成纹样（含可选的回纹边饰装饰层）。
 * 边饰只对非边饰模板生效，避免"回纹叠回纹"。
 */
export function generatePatternStrokes(id: PatternKind, raw: PatternParameters): GeneratedPattern {
  const p = clampPatternParameters(raw);
  const gen = GENERATORS[id] ?? GENERATORS.blank;
  const result = gen.generate(p);

  if (!p.borderEnabled || id === 'huiwen-border') return result;

  const border = buildHuiwenStrokes(p, p.borderRepeat);
  const strokes: LatticeStroke[] = dedupeStrokeIds([...result.strokes, ...border]);
  return {
    strokes,
    label: `${result.label} · 含回纹边饰`,
    modelNote: result.modelNote,
  };
}

/** 拼接后的 stroke id 可能撞车（都是基于局部序号），统一加后缀保证稳定唯一 */
function dedupeStrokeIds(strokes: LatticeStroke[]): LatticeStroke[] {
  const seen = new Set<string>();
  return strokes.map((s, i) => {
    if (!seen.has(s.id)) {
      seen.add(s.id);
      return s;
    }
    let id = `${s.id}#${i}`;
    while (seen.has(id)) id += '_';
    seen.add(id);
    return { ...s, id };
  });
}
