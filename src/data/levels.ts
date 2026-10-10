import type { LevelDefinition, LightDefinition, Transform3D } from '../gameplay/LevelData';

/**
 * 关卡数据。
 *
 * 设计方式：先构思"墙上应该出现什么样的影子布局"，再用 place() 反算物体应当摆放的位置。
 * 这样目标图案的形状是确定的，且目标状态一定可被解出（目标掩码本身就是由 target 变换生成的）。
 *
 *   t = Lz / (Lz - Pz)
 *   Px = Lx + (Qx - Lx) / t
 *   Py = Ly + (Qy - Ly) / t
 */

interface LightLike {
  x: number;
  y: number;
  z: number;
}

/** 由"期望的影子中心位置"反算物体的世界坐标 */
function place(
  light: LightLike,
  shadow: { x: number; y: number },
  z: number,
  rotation: { x?: number; y?: number; z?: number } = {},
): Transform3D {
  const denom = light.z - z;
  const t = Math.abs(denom) < 1e-4 ? 1 : light.z / denom;
  return {
    x: light.x + (shadow.x - light.x) / t,
    y: light.y + (shadow.y - light.y) / t,
    z,
    rotationX: rotation.x ?? 0,
    rotationY: rotation.y ?? 0,
    rotationZ: rotation.z ?? 0,
  };
}

// ───────────────────────────────── 第 1 关 ─────────────────────────────────
const L1_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L1 = L1_LIGHT.target;

// ───────────────────────────────── 第 2 关 ─────────────────────────────────
const L2_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L2 = L2_LIGHT.target;

// ───────────────────────────────── 第 3 关 ─────────────────────────────────
const L3_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L3 = L3_LIGHT.target;

// ───────────────────────────────── 第 4 关 ─────────────────────────────────
const L4_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L4 = L4_LIGHT.target;

// ───────────────────────────────── 第 5 关 ─────────────────────────────────
const L5_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L5 = L5_LIGHT.target;

// ───────────────────────────────── 第 6 关 ─────────────────────────────────
const L6_LIGHT: LightDefinition = {
  initial: { x: 1.2, y: 5.0, z: 13 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L6 = L6_LIGHT.target;
const L6_INIT = L6_LIGHT.initial;

export const LEVELS: LevelDefinition[] = [
  {
    id: 1,
    title: '光的初遇',
    description: '把一个方块的影子挪到墙上的目标位置。',
    tutorial: '点击选中方块，按住左键拖动它，观察墙上的影子如何跟着移动。',
    light: L1_LIGHT,
    objects: [
      {
        id: 'block',
        name: '方块',
        shape: 'square',
        color: '#e8a33d',
        initial: place(L1, { x: -3.4, y: 6.6 }, 4),
        target: place(L1, { x: 2.8, y: 5.0 }, 4),
      },
    ],
    matchThreshold: 0.8,
    excellentThreshold: 0.84,
    masterThreshold: 0.86,
    recommendedMoves: 14,
    hintSteps: [
      '先点击方块选中它，选中后会出现高亮描边。',
      '按住鼠标左键拖动方块，影子会朝相反的方向偏移。',
      '影子比物体更大，因为它被光源放大了；继续微调直到轮廓重合。',
    ],
    controls: {
      move: true,
      rotate: false,
      flip: false,
      depth: false,
      light: false,
      lightDistance: false,
    },
  },

  {
    id: 2,
    title: '角度的秘密',
    description: '旋转三角形，让影子的朝向与目标一致。',
    tutorial: '这一关可以使用旋转：选中三角形后，用 Q / E 或右侧按钮转动它。',
    light: L2_LIGHT,
    objects: [
      {
        id: 'tri',
        name: '三角板',
        shape: 'triangle',
        color: '#4aa3c7',
        scale: 1.35,
        initial: place(L2, { x: -2.2, y: 6.2 }, 4, { z: -35 }),
        target: place(L2, { x: 1.6, y: 5.4 }, 4, { z: 40 }),
      },
    ],
    matchThreshold: 0.79,
    excellentThreshold: 0.83,
    masterThreshold: 0.85,
    recommendedMoves: 22,
    hintSteps: [
      '先把三角形拖到大致位置，再处理角度。',
      '用 Q / E 每次旋转 15°，观察影子尖端朝哪边转。',
      '物体与影子的旋转方向一致，微调几次就能对准。',
    ],
    controls: {
      move: true,
      rotate: true,
      flip: false,
      depth: false,
      light: false,
      lightDistance: false,
    },
  },

  {
    id: 3,
    title: '远近之间',
    description: '改变物体与光源的距离，让圆影放大到目标大小。',
    tutorial: '底部新增了光源面板。拖动"物体深度"滑杆，物体离墙越远，影子越大。',
    light: L3_LIGHT,
    objects: [
      {
        id: 'disc',
        name: '圆盘',
        shape: 'circle',
        color: '#8fbf6a',
        initial: place(L3, { x: -1.2, y: 4.9 }, 2),
        target: place(L3, { x: 0.2, y: 5.6 }, 7),
      },
    ],
    matchThreshold: 0.81,
    excellentThreshold: 0.85,
    masterThreshold: 0.87,
    recommendedMoves: 26,
    hintSteps: [
      '影子比目标小，说明物体离投影墙太近了。',
      '把"物体深度"滑杆往右拉，物体靠近光源，影子会被放大。',
      '放大后位置也会偏移，回到移动面板微调中心即可。',
    ],
    controls: {
      move: true,
      rotate: false,
      flip: false,
      depth: true,
      light: true,
      lightDistance: true,
    },
  },

  {
    id: 4,
    title: '组合的艺术',
    description: '用三个几何体拼出一棵树的剪影。',
    tutorial: '现在有多个物体了：点击不同的物体可以切换选中，逐个摆好它们的位置。',
    light: L4_LIGHT,
    objects: [
      {
        id: 'trunk',
        name: '树干',
        shape: 'rectangle',
        color: '#b4753f',
        initial: place(L4, { x: -4.2, y: 3.0 }, 4, { z: 0 }),
        target: place(L4, { x: 0, y: 2.7 }, 4, { z: 90 }),
      },
      {
        id: 'crown',
        name: '树冠下',
        shape: 'circle',
        color: '#6fae5a',
        initial: place(L4, { x: -1.4, y: 7.6 }, 4),
        target: place(L4, { x: 0, y: 5.2 }, 4),
      },
      {
        id: 'treetop',
        name: '树冠上',
        shape: 'triangle',
        color: '#4f8f4a',
        initial: place(L4, { x: 3.6, y: 2.4 }, 4, { z: 160 }),
        target: place(L4, { x: 0, y: 7.0 }, 4, { z: 0 }),
      },
    ],
    matchThreshold: 0.83,
    excellentThreshold: 0.87,
    masterThreshold: 0.89,
    recommendedMoves: 44,
    hintSteps: [
      '先摆最显眼的"树冠上"三角形：它应当是尖朝上的。',
      '树干要竖起来——旋转到 90° 才会变成竖直的长条。',
      '三个影子需要互相衔接，中间不要留下明显的空隙。',
    ],
    controls: {
      move: true,
      rotate: true,
      flip: false,
      depth: true,
      light: false,
      lightDistance: false,
    },
  },

  {
    id: 5,
    title: '飞鸟的轮廓',
    description: '组合菱形与两侧翅膀，拼出一只展翅的飞鸟。',
    tutorial: '本关开放了翻转控制，可以调整物体的侧倾角度。',
    light: L5_LIGHT,
    objects: [
      {
        id: 'body',
        name: '鸟身',
        shape: 'diamond',
        color: '#5b8dd6',
        initial: place(L5, { x: -0.6, y: 2.2 }, 3, { z: 0 }),
        target: place(L5, { x: 0, y: 4.6 }, 4, { z: 0 }),
      },
      {
        id: 'wingL',
        name: '左翼',
        shape: 'triangle',
        color: '#7ba7e0',
        initial: place(L5, { x: -4.4, y: 5.6 }, 4, { z: 0 }),
        target: place(L5, { x: -1.7, y: 5.5 }, 4, { z: 28 }),
      },
      {
        id: 'wingR',
        name: '右翼',
        shape: 'triangle',
        color: '#7ba7e0',
        initial: place(L5, { x: 4.0, y: 3.2 }, 4, { z: 90 }),
        target: place(L5, { x: 1.7, y: 5.5 }, 4, { z: -28 }),
      },
    ],
    matchThreshold: 0.8,
    excellentThreshold: 0.84,
    masterThreshold: 0.86,
    recommendedMoves: 46,
    hintSteps: [
      '鸟身在正下方，左右两翼在它上方两侧，整体左右对称。',
      '两翼的三角形要向内倾斜：左翼约 -28°，右翼约 +28°。',
      '让翅膀的底边压住鸟身，中间不要断开，鸟的轮廓才完整。',
    ],
    controls: {
      move: true,
      rotate: true,
      flip: true,
      depth: true,
      light: false,
      lightDistance: false,
    },
  },

  {
    id: 6,
    title: '光影之城',
    description: '把六块几何体摆成高低错落的城市天际线。',
    tutorial: '最终挑战：综合使用移动、旋转、深度与光源调整。',
    light: L6_LIGHT,
    objects: [
      {
        id: 't1',
        name: '西楼',
        shape: 'rectangle',
        color: '#c2703f',
        scale: 0.8,
        initial: place(L6_INIT, { x: -5.4, y: 7.4 }, 4, { z: 0 }),
        target: place(L6, { x: -6, y: 2.71 }, 4, { z: 90 }),
      },
      {
        id: 't2',
        name: '钟楼',
        shape: 'rectangle',
        color: '#d08a4a',
        scale: 1.3,
        initial: place(L6_INIT, { x: -2.6, y: 8.0 }, 4, { z: 20 }),
        target: place(L6, { x: -3, y: 3.71 }, 4, { z: 90 }),
      },
      {
        id: 't3',
        name: '主塔',
        shape: 'rectangle',
        color: '#e0a35a',
        scale: 1.7,
        initial: place(L6_INIT, { x: 1.2, y: 2.6 }, 4, { z: 0 }),
        target: place(L6, { x: 0, y: 4.41 }, 4, { z: 90 }),
      },
      {
        id: 'spire',
        name: '塔尖',
        shape: 'triangle',
        color: '#f0c070',
        initial: place(L6_INIT, { x: 3.4, y: 8.6 }, 4, { z: 150 }),
        target: place(L6, { x: 0, y: 8.45 }, 4, { z: 0 }),
      },
      {
        id: 't4',
        name: '东楼',
        shape: 'rectangle',
        color: '#c2703f',
        scale: 1.0,
        initial: place(L6_INIT, { x: 5.6, y: 6.4 }, 4, { z: -60 }),
        target: place(L6, { x: 3, y: 3.09 }, 4, { z: 90 }),
      },
      {
        id: 't5',
        name: '东塔',
        shape: 'rectangle',
        color: '#b4653a',
        scale: 0.8,
        initial: place(L6_INIT, { x: 6.6, y: 3.0 }, 4, { z: 45 }),
        target: place(L6, { x: 6, y: 2.71 }, 4, { z: 90 }),
      },
    ],
    matchThreshold: 0.83,
    excellentThreshold: 0.87,
    masterThreshold: 0.88,
    recommendedMoves: 68,
    hintSteps: [
      '所有楼都要旋转到 90° 才会竖起来，先从最矮的两栋开始。',
      '楼底应排在同一条水平线上，高度由各自的尺寸决定。',
      '最后微调光源：把光源 X 移回中间、高度调到 5.5 附近。',
    ],
    controls: {
      move: true,
      rotate: true,
      flip: false,
      depth: true,
      light: true,
      lightDistance: true,
    },
  },
];

/** 自由实验室的初始物体（不属于正式关卡，仅在全部通关后解锁） */
export const LAB_OBJECTS = [
  { id: 'lab1', name: '方块', shape: 'square', color: '#e8a33d' } as const,
  { id: 'lab2', name: '圆盘', shape: 'circle', color: '#4aa3c7' } as const,
  { id: 'lab3', name: '三角', shape: 'triangle', color: '#8fbf6a' } as const,
];

export function getLevelById(id: number): LevelDefinition | undefined {
  return LEVELS.find((l) => l.id === id);
}

export const TOTAL_LEVELS = LEVELS.length;
