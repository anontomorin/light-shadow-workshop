/**
 * 文化资料来源的数据类型。
 *
 * 设计原则（对应开发文档 1.2 与 7.3）：
 *   - 资料集中维护在代码数据层，不散落到各个 UI 组件的硬编码文本里；
 *   - 每条资料必须带机构、标题、URL 与核查日期，界面可以直达来源；
 *   - 「寓意 / 时代 / 地域」这类结论只在来源确实支持时才写入数据，
 *     没有证据就留空，由界面决定是否显示该字段。
 */

/** 一条可追溯的文化/技术资料 */
export interface CultureSource {
  id: string;
  /** 资料标题 */
  title: string;
  /** 发布机构 */
  publisher: string;
  url: string;
  /** 核查日期（YYYY-MM-DD） */
  accessedAt: string;
  /** 本资料可以支持的结论（用于开发者自查，界面不必展示） */
  supports: string;
}

/** 文化卡片：结构特点 / 本项目怎样生成 / 来源 */
export interface CultureCard {
  patternId: string;
  /** 官方或来源支持的名称 */
  title: string;
  /** 形态说明（来源支持的可见结构描述） */
  formDescription: string;
  /** 本项目里的简化数字构造说明 */
  constructionNote: string;
  /**
   * 有来源明确支持时才会出现的语境/寓意。
   * 未确证时保持 undefined，界面不显示该字段。
   */
  meaning?: string;
  /** 数字示意 / 简化模型的边界声明，界面必须显示 */
  modelNote: string;
  sourceIds: string[];
}
