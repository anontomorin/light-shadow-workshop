# 光影工坊：影子设计师

一款以**三维空间关系**和**投影变化**为核心机制的浏览器益智游戏。玩家在明亮的光影工作室里移动、旋转几何物体并调整光源位置，让墙上的影子与目标轮廓重合。

- **技术栈**：Vite + TypeScript + Three.js（渲染）+ Canvas 2D（掩码计算）
- **运行形态**：纯前端，无后端、无账号、无数据库
- **核心机制**：真实几何投影计算 + 像素掩码 IoU 轮廓匹配（非预设动画、非进度条伪造）
- **在线试玩**：<https://anontomorin.github.io/light-shadow-workshop/>

---

## 一、运行与构建

环境要求：Node.js ≥ 18（开发使用 Node 22）。

```bash
npm install          # 安装依赖

npm run dev          # 启动开发服务器，默认 http://localhost:5173
npm run build        # 类型检查 + 生产构建，产物输出到 dist/
npm run preview      # 本地预览 dist/ 构建产物
npm run typecheck    # 仅运行 TypeScript 类型检查
npm run verify       # 关卡可解性验证（ASCII 预览 + IoU 数值校验）
```

> 若 `npm install` 因网络原因卡住，可指定国内镜像：
> `npm install --registry=https://mirrors.cloud.tencent.com/npm/`

**端到端冒烟测试**（需先 `npm run dev` 启动服务）：

```bash
node scripts/e2e-check.mjs
```

它通过 Chrome DevTools Protocol 驱动真实浏览器，覆盖 34 项检查：页面无异常、WebGL 可用、
标题页 → 关卡页 → 游戏页流程、真实鼠标拖动改变位置并实时刷新匹配度、真实操作触发通关、
6 关逐关可解、重置/提示/下一关、刷新后存档恢复，并顺带产出 `docs/shots/` 截图。

部署时把 `dist/` 目录整体上传到任意静态托管即可（Nginx / OSS / GitHub Pages 等）。

### GitHub Pages 自动部署

仓库已配置 `.github/workflows/deploy-pages.yml`：向 `main` 分支推送后会自动执行
`npm ci` → `npm run build` → 发布到 GitHub Pages，并在 Actions 页面手动触发（workflow_dispatch）。

- 在线地址：<https://anontomorin.github.io/light-shadow-workshop/>
- 页面路径由 Pages 的子路径 `/light-shadow-workshop/` 提供，因此 `vite.config.ts` 中已把
  `base` 设为 `'./'`（相对路径），确保子目录下资源不会 404。

---

## 二、操作方法

桌面端以鼠标为主，键盘为辅。

| 操作 | 行为 |
|---|---|
| 左键点击物体 | 选中物体，显示高亮描边 |
| 按住左键拖动 | 在操作平面内移动选中物体，影子实时跟随 |
| `Q` / `E` | 选中物体逆时针 / 顺时针旋转 15° |
| 右侧面板滑杆 | 调整选中物体的**旋转**（翻转）与**深度**（离墙距离） |
| 光源控制滑杆 | 调整光源**水平位置**、**高度**、**距离**（改变整体投影比例） |
| 滚轮 | 缩放视角 |
| `R` | 重置当前关卡 |
| `H` | 显示一条提示 |
| `Esc` | 暂停 / 关闭弹窗 |

**通关规则**：墙上影子的轮廓匹配度（IoU）达到本关阈值并连续两次校验通过即通关。拖动过程中不判负、不计时，操作次数只影响结算评价（完成 / 优秀 / 大师）。

---

## 三、技术说明

### 3.1 几何投影公式

采用**点光源 + 平面投影**的简化几何模型。坐标约定：`X` 为墙面水平方向，`Y` 为垂直方向，
`Z` 为深度方向，投影墙位于 `Z = 0`，光源位于正 `Z` 端且比所有物体更靠近观察者。

设点光源 `L = (Lx, Ly, Lz)`，物体顶点 `P = (Px, Py, Pz)`，墙平面 `z = Zw`，则光源过顶点的射线与墙面交点 `Q`：

```text
t  = (Lz - Zw) / (Lz - Pz)
Qx = Lx + t * (Px - Lx)
Qy = Ly + t * (Py - Ly)
```

实现要点（`src/projection/Projector.ts`）：

- **顶点变换**：读取几何体局部顶点，用 `Matrix4.compose(position, quaternion, scale)` 得到世界坐标；
- **异常保护**：当 `|Lz − Pz| < 1e-4`（顶点逼近光源）时返回 `null` 并丢弃该顶点；全局还有深度安全余量
  `MIN_LIGHT_GAP = 2.0`，物体与光源的深度差不会小于该值。
- **轮廓取凸包**：所有基础形状都是凸多边形，且物体有薄厚度（前后两层顶点）。
  对投影点集求 **Andrew monotone chain 凸包**，一步完成「外轮廓提取」与「前后两层合并」。
- **墙面裁剪**：用 **Sutherland–Hodgman** 算法把投影多边形裁到墙面矩形内，超界部分丢弃。

> 这是针对指定几何体的投影计算，**不是**完整的真实光学仿真，不涉及波长、干涉、衍射等现象。

### 3.2 轮廓匹配算法

`src/projection/SilhouetteRasterizer.ts` + `SilhouetteMatcher.ts`：

1. 墙面取 `18 × 10` 世界单位的标准区域，映射到 `288 × 160` 的离屏 Canvas。
   `18/288 = 10/160 = 0.0625`，即**每个像素恰好对应各向同性的世界尺度**，IoU 不受方向影响。
2. 当前影子与目标轮廓使用**同一套 `wallToMask` 坐标映射**，保证显示与判定一致。
3. 多边形以纯色填充到离屏 Canvas，读取像素后按 Alpha 阈值二值化为掩码。
4. 计算交并比：

```text
IoU = 交集像素数 / 并集像素数
```

- **节流**：拖动过程中使用降采样低分辨率预览（只在参数变化时重算），松手后再做完整校验，避免每帧读像素。
- **目标轮廓固定**：目标掩码在关卡加载时由「目标变换参数」一次性生成，**不随玩家移动光源而跟随变化**。
- **防误判**：判定基于整个目标区域的掩码而非局部重合，且要求连续两次达标才通关。

### 3.3 交互实现

- **拾取**：`THREE.Raycaster` 对物体做射线相交；
- **拖动**：把鼠标射线与通过物体当前位置的**操作平面**求交，增量位移施加到物体上，避免屏幕上的突然跳跃；
- **边界限制**：物体与光源都被限制在 `OBJECT_LIMITS` / `LIGHT_LIMITS` 合法区域内，非法值经 `clampSafe` 回退；
- **拖拽期间**的匹配度更新做了节流，松手后做完整校验。

### 3.4 目录结构

```text
src/
├── main.ts                     入口：创建 GameApp
├── app/
│   ├── GameApp.ts              总控：串联场景 / 关卡 / UI / 流程
│   ├── GameState.ts            存档（localStorage）：解锁进度、评价、音效开关
│   └── SoundKit.ts             轻量 WebAudio 音效（可静音）
├── scene/
│   ├── SceneManager.ts         WebGLRenderer / 相机 / 循环 / 尺寸自适应
│   ├── StudioScene.ts          工作室、投影墙、物体、光源的可视化
│   ├── GeometryFactory.ts      三角/方/长方/圆/六边/菱形薄片几何体
│   └── ProjectionRenderer.ts   墙面影子与目标轮廓的渲染
├── gameplay/
│   ├── LevelData.ts            类型定义（Transform3D / LevelDefinition 等）
│   ├── LevelManager.ts         关卡加载、初始/目标状态、掩码生成、解锁
│   ├── InteractionController.ts 拾取 / 拖动 / 旋转 / 深度
│   ├── LightController.ts      光源位置与距离控制
│   └── CompletionChecker.ts    IoU 数值计算与连续校验
├── projection/
│   ├── Projector.ts            投影公式、凸包、墙面裁剪、坐标映射
│   ├── SilhouetteRasterizer.ts 多边形 → 离屏 Canvas 二值掩码
│   └── SilhouetteMatcher.ts    掩码 IoU 计算
├── ui/
│   ├── dom.ts                  极简 DOM 构造工具
│   ├── TitleScreen.ts          标题页
│   ├── LevelSelect.ts          关卡选择页
│   ├── GameHUD.ts              游戏内 HUD（物体面板 / 光源 / 匹配度 / 底部操作）
│   ├── ResultModal.ts          通关结算弹窗
│   └── SettingsPanel.ts        暂停 / 设置面板
├── styles/
│   ├── global.css              变量、排版、基础样式
│   ├── screens.css             标题页 / 关卡页 / 弹窗
│   └── components.css          HUD 控件、滑杆、进度条
└── data/
    └── levels.ts               6 个关卡的完整配置
```

场景渲染、投影计算、关卡逻辑与 UI 相互独立，没有任何一个文件同时承担两类职责。

---

## 四、关卡设计

6 个关卡均通过 `src/data/levels.ts` 配置，配置项包含每关的初始/目标光源、各物体的初始/目标变换、
通关阈值与高评价阈值、分阶段提示、建议操作次数。

| 关卡 | 名称 | 物体 | 教学目标 |
|---|---|---|---|
| 1 | 光的初遇 | 1 个方块 | 选中、拖动，观察影子跟随 |
| 2 | 角度的秘密 | 1 个三角形 | 旋转物体，理解姿态对投影的影响 |
| 3 | 远近之间 | 1 个圆/方 | 调整光源距离与物体深度，观察投影缩放 |
| 4 | 组合的艺术 | 长方 + 圆/三角 | 多物体组合出**树形**轮廓 |
| 5 | 飞鸟的轮廓 | 菱形主体 + 2 翅膀 | 组合出抽象**飞鸟**形状 |
| 6 | 光影之城 | 4—6 个基础形状 | 组合成**城市天际线**（综合关） |

**关卡可解性验证**：`npm run verify` 会为每关

1. 用目标变换参数生成目标掩码，做 CPU 端 ASCII 预览（可直接肉眼检查图案是否可辨认）；
2. 将状态置为目标参数，计算与目标掩码的 IoU，必须 ≈ 1.0；
3. 对目标参数施加「粗对齐 / 精对齐」两档扰动，确认阈值留有合理容错；
4. 恢复初始状态，确认与目标存在明显差异；
5. 校验深度合法性与目标是否贴边。

6 关目标状态实测 IoU **全部为 1.0000**。

---

## 五、测试记录

### 5.1 已通过的验证

- `npm run build`：通过（`tsc --noEmit` 无错误，Vite 构建成功，28 modules，产物 gzip 约 148 KB）
- `npm run verify`：6 关全部通过（目标 IoU = 1.0000，初始状态差异明显，深度合法）
- `node scripts/e2e-check.mjs`：**34 / 34 项通过**，包含真实鼠标拖动路径
  （采样 `0.00 → 0.00 → 0.00 → 0.24 → 0.81 → 1.000` 并触发通关）、6 关逐关可解、
  刷新后存档恢复、无页面异常、无 console error
- **对生产构建产物复测**：`npm run preview` 后
  `E2E_URL=http://localhost:4173 node scripts/e2e-check.mjs` 同样 **34 / 34 通过**，
  证明交付的 `dist/` 与开发模式行为一致
- **对线上 GitHub Pages 复测**：
  `E2E_URL=https://anontomorin.github.io/light-shadow-workshop/ E2E_BOOT_WAIT=20000 node scripts/e2e-check.mjs`
  同样 **34 / 34 通过**，证明线上链接可以完整游玩（含真实鼠标拖动通关与六关遍历）

> `E2E_BOOT_WAIT` / `E2E_RELOAD_WAIT` 用于放宽首屏等待，默认 2500 / 2400 毫秒，
> 适合本地；访问线上站点时受网络影响需要调大。

### 5.2 核心功能截图（`docs/shots/`）

| 文件 | 内容 |
|---|---|
| `01-title.png` | 标题页 |
| `02-level-select.png` | 关卡选择页（初始仅解锁第 1 关） |
| `03-level1-initial.png` | 第 1 关操作界面（初始状态，匹配度 0%） |
| `04-after-drag.png` | 真实拖动到目标位置后的通关结算（大师评价） |
| `05-hint.png` | 提示系统 |
| `06-level2.png` | 第 2 关（旋转机制） |
| `03-level3.png` / `04-level4.png` | 第 3 关（光源距离）/ 第 4 关（树形组合） |
| `05-level5.png` / `06-level6.png` | 第 5 关（飞鸟）/ 第 6 关（城市天际线） |
| `07-final-result.png` | 第 6 关通关演出 |
| `08-after-reload.png` | 刷新后存档恢复 |

---

## 六、已知限制与未实现功能

已实现：6 个完整关卡、关卡选择与解锁、提示系统、三档评价、本地存档、
选中/拖动/旋转/深度/光源控制、暂停与重置、通关演出、轻量音效（可静音）。

已知限制：

- 投影为**几何投影模型**，非真实光学仿真；不模拟焦距、半影、折射等。
- 摄像机为固定三分之四视角（允许少量缩放/平移），不支持自由环绕，以免玩家转到无法理解投影关系的位置。
- 物体投影统一取**凸包**：对当前所有关卡的基础凸形状完全正确；若未来引入凹多边形，需要改为按边投影或并集处理。
- 仅在桌面端近年版本 Chrome 实测通过；Firefox / Safari / Edge 建议实机复测。
- 窄窗口（< 1024 px）下 HUD 会压缩，未做移动端专门适配。

未实现（原文档中列为 P1 / P2 或可选）：

- **自由实验室**（P1 可选）：先完成 6 关主流程后再决定是否实现，当前未做。
- 音效之外的可选音效素材与无障碍设置、自定义影子创作与截图导出、XR / AR 模式均未实现。

---

## 七、交付内容

- 完整源代码（`src/`、`scripts/`）
- 本 `README.md`
- 可直接部署的静态构建产物 `dist/`（`npm run build` 生成）
- 核心功能截图 `docs/shots/`
- 关卡可解性验证脚本 `scripts/verify-levels.ts` 与端到端测试 `scripts/e2e-check.mjs`
