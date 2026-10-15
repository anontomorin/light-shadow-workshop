import { h } from './dom';
import { ALL_SOURCES } from '../culture/patternCatalog';

/**
 * 「作品与资料」页：项目说明、文化来源清单、技术要点与已知边界。
 *
 * 来源清单直接读自 src/culture/patternCatalog.ts（数据层唯一来源），
 * 界面不硬编码任何链接，避免出现"代码改了、说明没改"的不一致。
 */
export class AboutPanel {
  readonly root: HTMLElement;

  constructor(handlers: { onClose: () => void; onOpenLibrary: () => void }) {
    const sources = h(
      'ul',
      { class: 'about-sources' },
      ALL_SOURCES.map((s) =>
        h('li', {}, [
          h('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', text: `${s.publisher}《${s.title}》` }),
          h('span', { class: 'tiny muted', text: `　核查日期 ${s.accessedAt}` }),
        ]),
      ),
    );

    const box = h('div', { class: 'modal about-modal', role: 'dialog', 'aria-modal': 'true' }, [
      h('h2', { text: '关于《光影工坊：窗棂之间》' }),
      h('p', {
        class: 'small',
        text: '《光影工坊：窗棂之间》以中国传统建筑窗棂为文化对象，以实时三维几何投影为技术核心：先认识纹样结构，再编辑自己的花窗，最后调节光源与空间位置，把纹样变成墙上的影子作品。此外还有两个以"影子"为核心的玩法（影形解谜与自由实验室），收在二级入口「光影挑战」里。',
      }),
      h('h3', { text: '技术要点' }),
      h('ul', { class: 'about-list' }, [
        h('li', { text: '技术栈：Vite + TypeScript + Three.js（Three.js 负责三维呈现，Canvas 2D 负责二值掩码与海报合成）。' }),
        h('li', {
          text: '投影模型：点光源到平面 z = 0 的几何投影（t = (Lz − Zw) / (Lz − Pz)）。这是几何模型，不是光学仿真。',
        }),
        h('li', {
          text: '镂空保留：每个物体先被分解成若干凸块（十字形 3 块、五角星 6 块、圆环 18 块、花窗由棂条逐根拆开），每块各自求凸包，再把所有多边形交给同一个栅格器做并集。把整个物体合成一个凸包会填死凹角与孔洞，因此被明确禁止。',
        }),
        h('li', { text: '显示与判定同源：墙面预览、投影读数与导出的 PNG 海报使用同一组投影多边形与同一个掩码栅格器。' }),
        h('li', { text: '界面风格：宣纸、墨、朱砂、碧玉、木色，全部由 CSS 与内联 SVG 绘制，不使用任何位图素材，也不加载网络字体。' }),
      ]),
      h('h3', { text: '文化资料来源' }),
      h('p', { class: 'tiny muted', text: '以下资料用于确定纹样名称、形态描述与来源记载的语境；参数化几何属于本项目的数字再设计。' }),
      sources,
      h('h3', { text: '已知边界' }),
      h('ul', { class: 'about-list' }, [
        h('li', { text: '纹样模板是依据公开资料整理的简化数字示意，不是文物精确复原；界面与导出都会标注这一点。' }),
        h('li', { text: '冰裂纹生成器输出的是风格化创作，种子相同可复现，但不代表唯一传统标准图样。' }),
        h('li', {
          text: '第 7–10 关的四道花窗题目（方格窗、菱花窗、冰裂纹、圆光窗）同样只是数字示意：标题用来指代窗式的构成方式，关卡内的构件尺寸与比例是本项目参数化生成的，不对应任何具体建筑实例。',
        }),
        h('li', { text: '自绘构图不支持任意孔洞布尔运算；单根棂条用矩形截面杆件建模。' }),
        h('li', {
          text: '凹形靠"凸块分解"实现，目前没有通用的差集运算：十字形、五角星、圆环都是手工给出的凸块方案，圆环用 18 个凸扇块近似（面积误差小于 0.5%），不是精确圆弧。',
        }),
        h('li', {
          text: '花窗题目的通关阈值（0.67–0.70）低于几何入门关（0.79–0.83）：细长棂条的轮廓对角度误差远比实心方块敏感，阈值是按实测可达性标定的，不是刻意降低要求。',
        }),
        h('li', { text: '未使用任何外部图片素材，全部图形由程序生成或自行截图。' }),
      ]),
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn', text: '打开作品集', onclick: () => handlers.onOpenLibrary() }),
        h('button', { class: 'btn btn-primary', text: '关闭', onclick: () => handlers.onClose() }),
      ]),
    ]);
    this.root = h('div', { class: 'modal-mask' }, [box]);
  }
}
