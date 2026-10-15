import type { Transform3D } from '../gameplay/LevelData';
import { relativeChange, snapshotOf, type MetricSnapshot, type ProjectionMetrics } from '../projection/ProjectionDiagnostics';

/**
 * 引导实验：用真实的投影读数解释"同一扇窗，影子为什么会变"。
 *
 * 设计原则：
 *   - 所有结论都从**本项目的点光源—平面几何模型**出发陈述，
 *     不称其为全局光照 / 物理渲染 / 完整光学仿真；
 *   - 提示文本随当前参数动态生成，不是写死的"影子变大了"；
 *   - 复位只恢复实验开始时记录的快照，不碰关卡存档与用户作品；
 *   - 不声称用户获得了经实验验证的学习提升。
 */

export type ExperimentKind = 'depth' | 'translate' | 'rotate' | 'density';

export interface ExperimentSpec {
  kind: ExperimentKind;
  title: string;
  question: string;
  steps: string[];
}

export const EXPERIMENTS: ExperimentSpec[] = [
  {
    kind: 'depth',
    title: '同一扇窗，影子为什么变大？',
    question: '窗格与光源之间的深度变化，会怎样改变墙上的影子大小？',
    steps: [
      '先不要动任何东西，记住当前投影尺寸读数。',
      '把窗格沿深度方向（Z）往后移动，观察读数变化。',
      '再把光源往前 / 往后移动，观察同样的窗格会有不同结果。',
      '点「重置实验」可以回到开始时的状态。',
    ],
  },
  {
    kind: 'translate',
    title: '平移窗格，影子会往哪走？',
    question: '在深度与光源都不变时，平移窗格会怎样改变影子的位置？',
    steps: [
      '保持深度滑杆不动，只改变窗格的左右 / 上下位置。',
      '观察影子的包围盒中心相对墙面的偏移方向。',
      '比较"移动窗格"和"移动光源"对影子的不同影响。',
    ],
  },
  {
    kind: 'rotate',
    title: '转动窗格，纹样会怎样被压扁？',
    question: '绕竖直轴转动窗格，为什么影子里的线条会变密、变窄？',
    steps: [
      '用「翻转角」滑杆改变窗格绕竖直轴的旋转。',
      '观察投影宽度读数与镂空率的变化。',
      '想一想：为什么转动之后影子的"空隙"看起来更少了。',
    ],
  },
  {
    kind: 'density',
    title: '棂条越细越密，影子会怎样？',
    question: '增加行列数、调细棂条，会怎样改变影子的连通性？',
    steps: [
      '提高行列数或降低棂条宽度，观察镂空率读数。',
      '把行列数调回较低值，比较影子里空白区域的变化。',
      '注意：这只是几何投影的必然结果，不代表真实木材的透光效果。',
    ],
  },
];

export interface ExperimentBaseline {
  kind: ExperimentKind;
  transform: Transform3D;
  light: { x: number; y: number; z: number };
  snapshot: MetricSnapshot;
  depth: number;
}

export interface Observation {
  running: boolean;
  narrative: string;
  widthPct: number | null;
  heightPct: number | null;
  areaPct: number | null;
  /** 与基准相比的深度变化（世界单位） */
  depthDelta: number;
}

const pct = (v: number | null): string => (v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`);

export class GuidedExperiments {
  private baseline: ExperimentBaseline | null = null;

  get running(): boolean {
    return this.baseline !== null;
  }

  get kind(): ExperimentKind | null {
    return this.baseline?.kind ?? null;
  }

  get spec(): ExperimentSpec | null {
    return EXPERIMENTS.find((e) => e.kind === this.baseline?.kind) ?? null;
  }

  /** 开始实验：记录窗格变换、光源位置与当前投影读数快照 */
  begin(
    kind: ExperimentKind,
    transform: Transform3D,
    light: { x: number; y: number; z: number },
    metrics: ProjectionMetrics,
  ): ExperimentBaseline {
    this.baseline = {
      kind,
      transform: { ...transform },
      light: { ...light },
      snapshot: snapshotOf(metrics),
      depth: transform.z,
    };
    return this.baseline;
  }

  /** 复位到实验开始时的状态（返回 null 表示当前没有进行中的实验） */
  restore(): { transform: Transform3D; light: { x: number; y: number; z: number } } | null {
    if (!this.baseline) return null;
    const b = this.baseline;
    this.baseline = null;
    return { transform: { ...b.transform }, light: { ...b.light } };
  }

  cancel(): void {
    this.baseline = null;
  }

  /** 根据当前真实读数生成动态叙述 */
  observe(metrics: ProjectionMetrics, transform: Transform3D): Observation {
    const b = this.baseline;
    if (!b) {
      return { running: false, narrative: '', widthPct: null, heightPct: null, areaPct: null, depthDelta: 0 };
    }
    const now = snapshotOf(metrics);
    const wPct = relativeChange(now.width, b.snapshot.width);
    const hPct = relativeChange(now.height, b.snapshot.height);
    const aPct = relativeChange(now.area, b.snapshot.area);
    const depthDelta = transform.z - b.depth;

    let narrative: string;
    switch (b.kind) {
      case 'depth':
        narrative =
          `窗格深度（离墙距离）${b.depth.toFixed(2)} → ${transform.z.toFixed(2)}（${depthDelta >= 0 ? '+' : ''}${depthDelta.toFixed(2)}）。` +
          `投影宽度 ${b.snapshot.width.toFixed(2)} → ${now.width.toFixed(2)}（${pct(wPct)}），` +
          `影子面积 ${pct(aPct)}。` +
          (Math.abs(depthDelta) < 0.05
            ? '当前深度与开始时几乎一致，可以试着拖动深度滑杆再看看。'
            : depthDelta > 0
              ? '窗格更靠近光源，投影被放大了——这是点光源到平面投影的几何必然结果。'
              : '窗格离光源更远了，投影变小。');
        break;
      case 'translate':
        narrative =
          `窗格中心 (${transform.x.toFixed(2)}, ${transform.y.toFixed(2)})，` +
          `投影宽度 ${pct(wPct)}、高度 ${pct(hPct)}，面积 ${pct(aPct)}。` +
          '深度与光源不变时，平移窗格主要改变影子的位置，尺寸基本不变。';
        break;
      case 'rotate':
        narrative =
          `翻转角 ${transform.rotationY.toFixed(0)}°，投影宽度 ${b.snapshot.width.toFixed(2)} → ${now.width.toFixed(2)}（${pct(wPct)}）。` +
          '绕竖直轴转动时，窗格在光线方向上的投影长度被压缩，线条因此看起来更密。';
        break;
      case 'density':
        narrative =
          `投影包围盒 ${now.width.toFixed(2)} × ${now.height.toFixed(2)}，` +
          `影子面积 ${pct(aPct)}，当前镂空率 ${(metrics.voidRatio * 100).toFixed(1)}%。` +
          '棂条越细越密，空隙被挤占得越多，镂空率会随之下降。';
        break;
      default:
        narrative = '';
    }

    return { running: true, narrative, widthPct: wPct, heightPct: hPct, areaPct: aPct, depthDelta };
  }

  /** 结束实验时的简短解释卡（基于当前几何模型的陈述） */
  conclusion(): string {
    const kind = this.baseline?.kind ?? 'depth';
    switch (kind) {
      case 'depth':
        return '在本项目的点光源—平面几何模型中，影子大小取决于光源、窗格与投影墙三者的相对位置。窗格越靠近光源，投影通常越大；具体数值以界面上的实测读数为准。';
      case 'translate':
        return '影子的位置由窗格位置与光源位置共同决定。保持深度不变时平移窗格，影子会向相反方向偏移并整体平移。';
      case 'rotate':
        return '窗格绕竖直轴转动后，它在光线方向上的有效宽度变小，投影随之被压缩，线条看起来更密。';
      case 'density':
        return '窗格的构件越密、棂条越粗，投影中被填满的区域就越多，镂空率下降。这是几何投影的直接结果，不代表真实木材的透光特性。';
      default:
        return '';
    }
  }
}
