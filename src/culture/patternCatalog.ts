import type { CultureCard, CultureSource } from './sourceTypes';

/**
 * 文化与技术资料来源目录 + 纹样资料卡。
 *
 * 内容边界（严格遵守开发文档 1.2）：
 *   1. 名称一律取自来源页面明确列出的叫法，不自造历史结论；
 *   2. 「时代 / 地域 / 寓意」只在来源确有陈述时才写，并且注明来自哪个机构；
 *   3. 程序参数化生成的几何属于数字再设计，必须标注「数字示意 / 风格化创作」，
 *      不声称复原任何具体文物；
 *   4. 每条资料都保留 URL 与核查日期，便于竞赛评审追溯。
 */

export const CULTURE_SOURCES: CultureSource[] = [
  {
    id: 'dpm-window-course',
    title: '一窗一世界——故宫里的窗',
    publisher: '故宫博物院',
    url: 'https://www.dpm.org.cn/curriculum/246426.html',
    accessedAt: '2026-10-15',
    supports: '故宫把窗的历史、种类与功能、窗棂主要图案与寓意、手工制作体验放在同一教育课程中。',
  },
  {
    id: 'dpm-winter-class',
    title: '原来你是这么有趣的故宫！——故宫寒假知识课堂再次开讲',
    publisher: '故宫博物院',
    url: 'https://www.dpm.org.cn/classify_detail/246425.html',
    accessedAt: '2026-10-15',
    supports:
      '教育活动列举三交六椀菱花式、步步锦式、冰裂纹式窗棂，并把识别图案与拼装窗棂台灯结合。',
  },
  {
    id: 'dpm-sanqiao-liuwan',
    title: '三交六椀菱花',
    publisher: '故宫博物院',
    url: 'https://www.dpm.org.cn/lemmas/241835.html',
    accessedAt: '2026-10-15',
    supports:
      '该纹样属清代宫殿建筑门窗槅心花纹装饰之一；由三根棂子交叉相接，交点装饰成花心，并有正交、斜交等构成方式。',
  },
  {
    id: 'hkpm-window-patterns',
    title: '纹窗弄影',
    publisher: '香港故宫文化博物馆',
    url: 'https://www.hkpm.org.hk/sc/the-ways-in-patterns-5',
    accessedAt: '2026-10-15',
    supports: '把窗棂纹样与季节光影体验结合，页面介绍三交六椀与步步锦的构成及相关文化解释。',
  },
  {
    id: 'sh-greenery-window',
    title: '古建筑之眼——窗棂',
    publisher: '上海市绿化和市容管理局',
    url: 'https://lhsr.sh.gov.cn/jnylwh/20220222/5f63d6ff0bbc4ef1b3c9c07de29cb182.html',
    accessedAt: '2026-10-15',
    supports: '解释传统窗棂的基本概念、所在部位，以及木棂条组合形成几何图案的过程。',
  },
  {
    id: 'unesco-suzhou',
    title: '苏州古典园林',
    publisher: '联合国教科文组织世界遗产中心',
    url: 'https://whc.unesco.org/zh/list/813',
    accessedAt: '2026-10-15',
    supports: '认可苏州古典园林整体设计与自然景观、空间意境的关系（不用于证明具体窗棂的名称或年代）。',
  },
  {
    id: 'xjtlu-ice-crack',
    title: '西浦国际学者探秘苏州园林窗棂冰裂纹',
    publisher: '西交利物浦大学',
    url: 'https://www.xjtlu.edu.cn/zh/news/2024/03/suzhouyuanlinbingliewen',
    accessedAt: '2026-10-15',
    supports: '从建筑设计与几何分形研究角度讨论冰裂纹与苏州园林窗棂。',
  },
  {
    id: 'three-shape',
    title: 'Three.js Documentation — Shape',
    publisher: 'Three.js',
    url: 'https://threejs.org/docs/pages/Shape.html',
    accessedAt: '2026-10-15',
    supports: 'Shape 可描述二维路径并支持可选孔洞，用于 ShapeGeometry / ExtrudeGeometry 构造。',
  },
  {
    id: 'three-extrude',
    title: 'Three.js Documentation — ExtrudeGeometry',
    publisher: 'Three.js',
    url: 'https://threejs.org/docs/pages/ExtrudeGeometry.html',
    accessedAt: '2026-10-15',
    supports: '把二维 Shape 沿深度拉伸为 BufferGeometry 及相关参数说明。',
  },
  {
    id: 'cmit-2026',
    title: '全国大学生数字媒体科技作品及创意竞赛官方网站',
    publisher: '全国大学生数字媒体科技作品及创意竞赛',
    url: 'https://www.cmit.cn/wap/index.html',
    accessedAt: '2026-10-15',
    supports: '2026 年度官网显示报名及常规作品提交截止为 2026-10-23 23:59:59（北京时间）；以官网最新通知为准。',
  },
];

/** 统一的「数字示意」声明文案 */
export const DIGITAL_MODEL_NOTE =
  '本模板是依据公开资料整理的参数化数字示意（教学简化模型），不是对任何具体文物或建筑构件的精确复原。';

export const STYLE_MODEL_NOTE =
  '本模板为受传统冰裂纹窗棂几何构成启发的风格化数字创作，生成结果每次可按种子复现，但不代表唯一传统标准图样。';

export const USER_MODEL_NOTE =
  '这是用户自绘内容，属于个人创作，不代表任何传统窗棂形制，也未使用历史纹样名称或寓意。';

export const CULTURE_CARDS: CultureCard[] = [
  {
    patternId: 'step-step-brocade',
    title: '步步锦式',
    formDescription:
      '以木棂条组成的矩形格网为基础，横棂与竖棂分段相接，格子之间留出规整的方形空隙，整体呈现层层递进的格律感。',
    constructionNote:
      '本工具先绘制外框与横、竖分格棂条，再在每个格心内按交错方向加入一段「阶梯」折线；行数、列数、阶梯内缩由滑杆控制。',
    meaning:
      '故宫博物院的教育活动页面把「步步锦式」与三交六椀菱花式、冰裂纹式并列作为窗棂图案示例（见故宫博物院《原来你是这么有趣的故宫！》）。本工具不引申该名称之外的象征解释。',
    modelNote: DIGITAL_MODEL_NOTE,
    sourceIds: ['dpm-winter-class', 'dpm-window-course', 'hkpm-window-patterns', 'sh-greenery-window'],
  },
  {
    patternId: 'ice-crack-style',
    title: '冰裂纹式（风格化）',
    formDescription:
      '由连续的折线把窗心分割成大小不一的多边形格面，格面之间没有两条完全平行的长线，看起来像冰面开裂。',
    constructionNote:
      '本工具在受约束的抖动网格上连线，并按固定种子随机关闭部分内部线段，从而得到不规则格面；密度与种子可调，同一种子结果完全一致。',
    meaning:
      '西交利物浦大学的文章从建筑设计与几何分形研究角度讨论过苏州园林窗棂冰裂纹，可作为延伸阅读；本条不代表对其年代、地域或象征的统一结论。',
    modelNote: STYLE_MODEL_NOTE,
    sourceIds: ['xjtlu-ice-crack', 'dpm-winter-class', 'unesco-suzhou'],
  },
  {
    patternId: 'three-cross-six-bowl-diamond',
    title: '三交六椀菱花式（数字示意）',
    formDescription:
      '由三根棂子在交点处交叉相接，交点位置装饰成花心，三点方向的连线把窗心分成菱花形的格面。',
    constructionNote:
      '本工具用三个方向（水平与 ±60°）的等距线组出菱花形格网，再在格网点位上放置简化的六瓣花心；列数、行数、花心大小可调。',
    meaning:
      '故宫博物院《三交六椀菱花》词条说明该纹样属清代宫殿建筑门窗槅心花纹装饰之一，并介绍三根棂子交叉、交点装饰花心以及正交/斜交等构成方式；香港故宫文化博物馆《纹窗弄影》页面补充了三交六椀与光影结合的展示方式。',
    modelNote: DIGITAL_MODEL_NOTE,
    sourceIds: ['dpm-sanqiao-liuwan', 'hkpm-window-patterns', 'dpm-window-course'],
  },
  {
    patternId: 'huiwen-border',
    title: '回纹边饰（辅助模块）',
    formDescription:
      '由连续折线组成的方形回旋纹，沿窗框内侧环绕一周，作为边框装饰层使用。',
    constructionNote:
      '本工具沿外框四条边重复绘制同一个回纹单元折线，重复次数可调。它是装饰性的辅助模块，不与上面三种窗棂样式作同一类型层级的比较。',
    modelNote: DIGITAL_MODEL_NOTE,
    sourceIds: ['dpm-window-course', 'sh-greenery-window'],
  },
  {
    patternId: 'blank',
    title: '空白窗格',
    formDescription: '只有外框、窗心留空的基础窗格，用于从零开始搭建或使用自绘工具。',
    constructionNote:
      '本工具只生成四根窗框棂条，窗心完全留空，可配合「画棂条」工具自由添加折线。',
    modelNote: USER_MODEL_NOTE,
    sourceIds: ['sh-greenery-window'],
  },
];

const SOURCE_MAP = new Map(CULTURE_SOURCES.map((s) => [s.id, s]));

export function getSources(ids: string[]): CultureSource[] {
  const out: CultureSource[] = [];
  for (const id of ids) {
    const s = SOURCE_MAP.get(id);
    if (s) out.push(s);
  }
  return out;
}

export function getCultureCard(patternId: string): CultureCard | null {
  return CULTURE_CARDS.find((c) => c.patternId === patternId) ?? null;
}

/** 供「作品与资料」页展示的完整来源清单（按机构归类前的原始顺序） */
export const ALL_SOURCES = CULTURE_SOURCES;
