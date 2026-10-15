import type {
  LevelDefinition,
  LightDefinition,
  ShapePart,
  Transform3D,
} from '../gameplay/LevelData';

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

// ═════════════════════ 花窗构件工具箱（第 7–10 关） ═════════════════════
//
// 这四关的题目取自经典花窗：方格窗、菱花窗、冰裂纹、窗棂总成。
// 每个"可操作物体"都是一个由棂条拼成的**复合构件** —— 玩家拖动的是整个构件，
// 投影时逐棂条求凸包再取并集，因此格眼（棂条之间的空隙）会被如实保留，
// 不会糊成一块实心窗板（这正是"花窗的影子"与"一块木板的影子"的区别）。
//
// 单位说明：构件尺寸用**物体局部单位**。目标状态统一放在 z = 4.0、光源在 z = 14，
// 投影放大率 t = 14 / (14 − 4) = 1.4，所以墙面上的影子尺寸 ≈ 局部尺寸 × 1.4。

/** 一根棂条：中心在 (dx, dy)，长 len、宽 wid，可绕自身中心旋转 rot（度） */
function slat(dx: number, dy: number, len: number, wid: number, rot = 0): ShapePart {
  return { shape: 'slat', dx, dy, w: len, h: wid, rot };
}

/** 一个菱形零件：直接标半宽 / 半高 */
function rhombus(dx: number, dy: number, halfW: number, halfH: number): ShapePart {
  return { shape: 'diamond', dx, dy, w: halfW * 2, h: halfH * 2 };
}

/** 矩形窗框：外框 halfW × halfH、框条厚 t。四段互不重叠，投影并集后是完整框 */
function frame(halfW: number, halfH: number, t: number): ShapePart[] {
  return [
    slat(0, halfH - t / 2, halfW * 2, t),
    slat(0, -halfH + t / 2, halfW * 2, t),
    slat(-halfW + t / 2, 0, t, halfH * 2 - t * 2),
    slat(halfW - t / 2, 0, t, halfH * 2 - t * 2),
  ];
}

/** 菱花心：中心一大菱 + 四周按 count 等分均布的小菱（六椀菱花的简化示意） */
function rosette(coreHalfW: number, coreHalfH: number, ringR: number, petalHalfW: number, petalHalfH: number, count = 6, startDeg = 30): ShapePart[] {
  const parts: ShapePart[] = [rhombus(0, 0, coreHalfW, coreHalfH)];
  for (let k = 0; k < count; k++) {
    const a = ((startDeg + (k * 360) / count) * Math.PI) / 180;
    parts.push(rhombus(Math.cos(a) * ringR, Math.sin(a) * ringR, petalHalfW, petalHalfH));
  }
  return parts;
}

// ───────────────────────────────── 第 7 关 ─────────────────────────────────
// 方格窗：外框 + 十字棂 + 四角菱花。最基础的一扇窗棂，用来认识"格眼"。
const L7_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L7 = L7_LIGHT.target;

const L7_HALF_W = 3.0;
const L7_HALF_H = 2.2;
const L7_BAR = 0.28;

// ───────────────────────────────── 第 8 关 ─────────────────────────────────
// 菱花窗：外框 + 三交棂（0° / 60° / 120° 三个方向交叉）+ 六椀菱花心。
const L8_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L8 = L8_LIGHT.target;

// ───────────────────────────────── 第 9 关 ─────────────────────────────────
// 冰裂纹：外框 + 两组互不对称的斜棂。因为不对称，角度方向错了就看得出。
const L9_LIGHT: LightDefinition = {
  initial: { x: 0.8, y: 5.2, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L9 = L9_LIGHT.target;
const L9_INIT = L9_LIGHT.initial;

// ───────────────────────────────── 第 10 关 ─────────────────────────────────
// 窗棂总成：外框 + 井字格 + 菱格 + 圆心，四类构件叠加成一扇完整的圆光窗。
const L10_LIGHT: LightDefinition = {
  initial: { x: 0, y: 5.5, z: 14 },
  target: { x: 0, y: 5.5, z: 14 },
};
const L10 = L10_LIGHT.target;

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

  // ─────────────────────── 花窗题目（第 7–10 关） ───────────────────────
  // 从这一关起，物体变成"花窗构件"：一整个窗框 / 一组棂条 / 一丛菱花。
  // 判断标准也随之上了一个台阶 —— 不只是大轮廓要对，格眼（棂条之间的空隙）
  // 也必须落在正确的位置，否则影子里那些缝隙对不上，IoU 立刻掉下来。
  {
    id: 7,
    title: '方格窗 · 十字棂',
    description: '把窗框、十字棂与四角菱花摆回原位，让墙上出现一扇方正的方格花窗。',
    tutorial:
      '本关的物体是"花窗构件"：窗框、十字棂、四角菱花各是一个整体。拖动整个构件摆位，用旋转滑杆校正朝向——注意窗格之间的空隙也会被如实投影出来。',
    light: L7_LIGHT,
    objects: [
      {
        id: 'w-frame',
        name: '窗框',
        shape: 'slat',
        parts: frame(L7_HALF_W, L7_HALF_H, L7_BAR),
        color: '#8a5a33',
        initial: place(L7, { x: -4.4, y: 7.0 }, 2.8, { z: 34 }),
        target: place(L7, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-cross',
        name: '十字棂',
        shape: 'cross',
        parts: [
          slat(0, 0, (L7_HALF_H - L7_BAR) * 2, 0.26),
          slat(0, 0, (L7_HALF_W - L7_BAR) * 2, 0.26),
        ],
        color: '#c2452d',
        initial: place(L7, { x: 4.6, y: 7.6 }, 5.0, { z: 62 }),
        target: place(L7, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-blossom',
        name: '四角菱花',
        shape: 'diamond',
        parts: [
          rhombus(-1.36, 0.96, 0.46, 0.6),
          rhombus(1.36, 0.96, 0.46, 0.6),
          rhombus(-1.36, -0.96, 0.46, 0.6),
          rhombus(1.36, -0.96, 0.46, 0.6),
        ],
        color: '#2f6b57',
        initial: place(L7, { x: -2.6, y: 2.2 }, 2.4, { z: -28 }),
        target: place(L7, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
    ],
    matchThreshold: 0.69,
    excellentThreshold: 0.72,
    masterThreshold: 0.75,
    recommendedMoves: 52,
    hintSteps: [
      '三个构件都要挪回墙的正中间：先摆最大的窗框，它的边要水平、竖直。',
      '窗框到位后，把"十字棂"转到与窗框对齐（旋转归零），它才能把窗分成四格。',
      '最后放"四角菱花"：四个菱形分别落在四格的正中，别压到棂条上。',
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
    id: 8,
    title: '菱花窗 · 三交六椀',
    description: '用外框、三交棂与六椀菱花心，拼出经典的三交六椀菱花窗轮廓。',
    tutorial:
      '三交棂是一组 0° / 60° / 120° 三个方向的棂条，六椀菱花心由 1 大 6 小共七枚菱形组成。转动构件时整个花心会一起转，注意让菱花心保持正立。',
    light: L8_LIGHT,
    objects: [
      {
        id: 'w-frame',
        name: '外框',
        shape: 'slat',
        parts: frame(3.0, 2.4, 0.3),
        color: '#8a5a33',
        initial: place(L8, { x: 4.4, y: 2.4 }, 3.0, { z: 48 }),
        target: place(L8, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-triple',
        name: '三交棂',
        shape: 'slat',
        parts: [
          slat(0, 0, 5.2, 0.26, 0),
          slat(0, 0, 5.2, 0.26, 60),
          slat(0, 0, 5.2, 0.26, 120),
        ],
        color: '#c2452d',
        initial: place(L8, { x: -4.8, y: 8.2 }, 5.4, { z: -22 }),
        target: place(L8, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-rosette',
        name: '六椀菱花心',
        shape: 'diamond',
        parts: rosette(0.55, 0.7, 1.35, 0.34, 0.44),
        color: '#d9a72c',
        initial: place(L8, { x: -0.8, y: 1.5 }, 2.2, { z: 36 }),
        target: place(L8, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
    ],
    matchThreshold: 0.69,
    excellentThreshold: 0.72,
    masterThreshold: 0.74,
    recommendedMoves: 58,
    hintSteps: [
      '外框仍是最先要摆正的：四条框条必须水平或竖直。',
      '三交棂旋回 0° 后，三根棂条才会呈 0° / 60° / 120° 的标准分布。',
      '六椀菱花心的中心大菱形要正立在窗心，周围六枚小菱形均匀环绕。',
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
    id: 9,
    title: '冰裂纹 · 碎影',
    description: '两组互不对称的斜棂拼出冰裂纹，这一关角度差一点就看得出。',
    tutorial:
      '冰裂纹没有对称轴，所以旋转角度必须真的对准。可以让一个构件先大致到位，再用角度滑杆逐度微调，看着墙上的缝隙收拢。',
    light: L9_LIGHT,
    objects: [
      {
        id: 'w-frame',
        name: '外框',
        shape: 'slat',
        parts: frame(2.9, 2.3, 0.26),
        color: '#8a5a33',
        initial: place(L9_INIT, { x: 5.0, y: 8.0 }, 2.8, { z: -36 }),
        target: place(L9, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-main',
        name: '主裂',
        shape: 'slat',
        parts: [
          slat(-0.4, 0.2, 5.8, 0.22, 72),
          slat(0.5, -0.3, 5.4, 0.22, -18),
          slat(-1.0, -1.1, 3.2, 0.2, 108),
        ],
        color: '#5fa8a0',
        initial: place(L9_INIT, { x: -5.2, y: 7.4 }, 5.6, { z: 54 }),
        target: place(L9, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-sub',
        name: '副裂',
        shape: 'slat',
        parts: [
          slat(0.9, 1.2, 3.0, 0.2, 24),
          slat(-1.2, 0.9, 3.4, 0.2, -52),
          slat(1.4, -1.0, 2.6, 0.2, 63),
        ],
        color: '#b98bd6',
        initial: place(L9_INIT, { x: -1.2, y: 2.0 }, 2.2, { z: -70 }),
        target: place(L9, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
    ],
    matchThreshold: 0.67,
    excellentThreshold: 0.7,
    masterThreshold: 0.72,
    recommendedMoves: 64,
    hintSteps: [
      '冰裂纹只有裂而不碎的一整块：先把外框摆正，再把两组斜棂挪到框内。',
      '两组斜棂的旋转角必须精确归零，否则缝隙的走向会整体偏掉。',
      '最后用方向键（按住 Shift 为粗调）把构件推到缝隙完全咬合的位置。',
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
    id: 10,
    title: '窗棂总成 · 圆光窗',
    description: '把外框、井字格、菱格与圆心四类构件叠合，组成一扇完整的圆光花窗。',
    tutorial:
      '最终挑战：四类构件层层叠合，深度也必须一致——同一扇窗的不同构件若不在同一深度，影子会被放大成不同大小，缝隙就对不上了。',
    light: L10_LIGHT,
    objects: [
      {
        id: 'w-frame',
        name: '外框',
        shape: 'slat',
        parts: frame(3.2, 2.5, 0.32),
        color: '#8a5a33',
        initial: place(L10, { x: -4.8, y: 8.0 }, 2.6, { z: 42 }),
        target: place(L10, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-grid',
        name: '井字格',
        shape: 'cross',
        parts: [slat(0, 0, (2.5 - 0.32) * 2, 0.26), slat(0, 0, (3.2 - 0.32) * 2, 0.26)],
        color: '#c2452d',
        initial: place(L10, { x: 4.6, y: 7.8 }, 5.8, { z: -54 }),
        target: place(L10, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-diag',
        name: '菱格',
        shape: 'slat',
        parts: [slat(0, 0, 7.0, 0.22, 45), slat(0, 0, 7.0, 0.22, -45)],
        color: '#d9a72c',
        initial: place(L10, { x: 0.6, y: 2.2 }, 3.2, { z: 28 }),
        target: place(L10, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
      {
        id: 'w-ring',
        name: '圆心',
        shape: 'ring',
        parts: [{ shape: 'ring', w: 2.6, h: 2.6 }],
        color: '#2f6b57',
        initial: place(L10, { x: -2.9, y: 1.7 }, 5.2, { z: -12 }),
        target: place(L10, { x: 0, y: 5.5 }, 4, { z: 0 }),
      },
    ],
    matchThreshold: 0.7,
    excellentThreshold: 0.73,
    masterThreshold: 0.76,
    recommendedMoves: 78,
    hintSteps: [
      '四类构件的深度都要拉到同一档（约 4.0），否则影子大小会不一致。',
      '井字格与菱格的旋转角都归零，它们才会与外框的边线对齐。',
      '圆心是一枚圆环——注意中间是镂空的，环形的里外边界都要对准。',
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
