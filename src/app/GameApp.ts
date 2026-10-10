import { SceneManager } from '../scene/SceneManager';
import { StudioScene } from '../scene/StudioScene';
import { SilhouetteRasterizer } from '../projection/SilhouetteRasterizer';
import { LevelManager } from '../gameplay/LevelManager';
import { LightController, type LightState } from '../gameplay/LightController';
import { InteractionController } from '../gameplay/InteractionController';
import { CompletionChecker, type Rank } from '../gameplay/CompletionChecker';
import { GameHUD } from '../ui/GameHUD';
import { TitleScreen } from '../ui/TitleScreen';
import { LevelSelect } from '../ui/LevelSelect';
import { ResultModal } from '../ui/ResultModal';
import { PausePanel } from '../ui/SettingsPanel';
import { GameState } from './GameState';
import { SoundKit } from './SoundKit';
import { getLevelById, LEVELS, TOTAL_LEVELS } from '../data/levels';
import type { LevelDefinition, ShadowObjectDefinition, Transform3D } from '../gameplay/LevelData';

type ScreenName = 'title' | 'levels' | 'game';

/** 匹配度预览的节流间隔（ms） */
const PREVIEW_INTERVAL = 90;
/** 操作结束到"确认校验"的间隔（ms） */
const COMMIT_DEBOUNCE = 160;
/** 首次达标后进行第二次确认校验的间隔（ms） */
const CONFIRM_DELAY = 200;

/**
 * 应用主控：串联场景、关卡、交互、判定与界面。
 * 自身不实现投影算法，也不直接拼装 DOM，只负责调度。
 */
export class GameApp {
  private root: HTMLElement;
  private state: GameState;
  private sound: SoundKit;

  private sceneManager: SceneManager;
  private studio: StudioScene;
  private rasterizer: SilhouetteRasterizer;
  private levelManager: LevelManager;
  private light: LightController;
  private interaction: InteractionController;
  private checker: CompletionChecker;

  private hud: GameHUD;
  private titleScreen: TitleScreen;
  private levelSelect: LevelSelect;

  private screen: ScreenName = 'title';
  private modal: HTMLElement | null = null;
  private currentLevel: LevelDefinition | null = null;

  private cleared = false;
  private hintIndex = 0;
  private projDirty = false;
  private lastIou = 0;

  private previewTimer: number | null = null;
  private commitTimer: number | null = null;
  private confirmTimer: number | null = null;

  private keyHandler: (e: KeyboardEvent) => void;

  constructor(root: HTMLElement) {
    this.root = root;
    this.state = new GameState();
    this.sound = new SoundKit();
    this.sound.enabled = this.state.soundEnabled;

    // ---- 界面 ----
    this.hud = new GameHUD({
      onBack: () => this.goLevels(),
      onPause: () => this.openPause(),
      onHint: () => this.showHint(),
      onReset: () => this.resetLevel(),
      onNext: () => this.nextLevel(),
      onSelectObject: (id) => this.selectObject(id),
      onRotate: (d) => this.rotateSelected(d),
      onFlip: (v) => this.flipSelected(v),
      onDepth: (v) => this.setDepth(v),
      onLightAxis: (axis, v) => this.setLightAxis(axis, v),
    });

    this.titleScreen = new TitleScreen(
      {
        onStart: () => this.startLevel(this.firstUnclearedLevel()),
        onLevelSelect: () => this.goLevels(),
      },
      'v1.0.0',
    );
    this.titleScreen.setLabUnlocked(this.state.labUnlocked);

    this.levelSelect = new LevelSelect(this.state, {
      onPick: (id) => this.startLevel(id),
      onBack: () => this.showScreen('title'),
    });

    // ---- 三维场景 ----
    this.sceneManager = new SceneManager(this.hud.stageEl);
    this.studio = new StudioScene();
    this.sceneManager.scene.add(this.studio.root);
    this.sceneManager.onFrame((dt) => this.onFrame(dt));

    // ---- 玩法 ----
    this.rasterizer = new SilhouetteRasterizer();
    this.levelManager = new LevelManager(this.rasterizer);
    this.light = new LightController((s) => this.applyLight(s));
    this.checker = new CompletionChecker(2);
    this.interaction = new InteractionController(
      this.studio,
      this.sceneManager,
      LEVELS[0].controls,
      {
        onSelect: (id) => this.onSelect(id),
        onChange: (id, t) => this.onObjectChange(id, t),
        onCommit: () => this.scheduleCommit(),
      },
    );

    this.keyHandler = (e: KeyboardEvent) => this.onKeyDown(e);
    window.addEventListener('keydown', this.keyHandler);

    this.showScreen('title');
    this.sceneManager.start();

    this.installDebugHook();
  }

  /**
   * 暴露一个只读 + 测试用的调试钩子，便于自动化测试与现场排查。
   * 它不会改变任何判定逻辑：solve() 只是把物体的变换写到目标参数上，
   * 之后的通关仍然要经过正常的投影计算与 IoU 校验。
   */
  private installDebugHook(): void {
    const api = {
      version: '1.0.0',
      getState: () => ({
        screen: this.screen,
        levelId: this.currentLevel?.id ?? null,
        cleared: this.cleared,
        moves: this.levelManager.moves,
        hintsUsed: this.levelManager.hintsUsed,
        light: this.light.get(),
        objects: this.currentLevel
          ? this.currentLevel.objects.map((o) => ({
              id: o.id,
              name: o.name,
              transform: this.levelManager.transforms.get(o.id) ?? null,
            }))
          : [],
        lastIou: this.lastIou,
        unlocked: this.state.unlocked,
      }),
      /** 测试用：把全部物体与光源设置为关卡的目标参数 */
      solve: () => {
        if (!this.currentLevel) return false;
        for (const obj of this.currentLevel.objects) {
          this.levelManager.setTransform(obj.id, { ...obj.target });
          this.studio.updateTransform(obj.id, obj.target);
        }
        this.light.setObjectDepthLimit(this.levelManager.maxObjectZ());
        this.light.set({ ...this.currentLevel.light.target });
        this.markDirty();
        this.scheduleCommit(true);
        return true;
      },
      /** 测试用：直接进入指定关卡 */
      goToLevel: (id: number) => {
        this.startLevel(id);
        return true;
      },
      /** 测试用：返回某个物体在屏幕上的像素坐标 */
      screenPos: (id: string) => {
        const t = this.levelManager.transforms.get(id);
        if (!t) return null;
        return this.sceneManager.worldToScreen({ x: t.x, y: t.y, z: t.z });
      },
      /** 测试用：返回某个物体目标位置对应的屏幕像素坐标 */
      targetScreenPos: (id: string) => {
        const obj = this.currentLevel?.objects.find((o) => o.id === id);
        if (!obj) return null;
        return this.sceneManager.worldToScreen({
          x: obj.target.x,
          y: obj.target.y,
          z: obj.target.z,
        });
      },
      /** 测试用：读取当前掩码与目标掩码的 IoU */
      score: () =>
        CompletionChecker.scoreOf(
          this.levelManager.currentMask(),
          this.levelManager.targetMask,
        ),
    };
    (window as unknown as { __lightShadow?: typeof api }).__lightShadow = api;
  }

  // ───────────────────────── 屏幕切换 ─────────────────────────

  private showScreen(name: ScreenName): void {
    this.closeModal();
    this.screen = name;
    this.root.replaceChildren();
    if (name === 'title') {
      this.titleScreen.setLabUnlocked(this.state.labUnlocked);
      this.root.append(this.titleScreen.root);
      this.sceneManager.stop();
    } else if (name === 'levels') {
      this.levelSelect.refresh();
      this.root.append(this.levelSelect.root);
      this.sceneManager.stop();
    } else {
      this.root.append(this.hud.root);
      this.sceneManager.start();
      this.sceneManager.resize();
    }
  }

  private firstUnclearedLevel(): number {
    for (let i = 1; i <= TOTAL_LEVELS; i++) {
      if (!this.state.getRecord(i).cleared) return Math.min(i, this.state.unlocked);
    }
    return TOTAL_LEVELS;
  }

  private goLevels(): void {
    this.interaction.setEnabled(false);
    this.showScreen('levels');
  }

  // ───────────────────────── 关卡流程 ─────────────────────────

  private startLevel(id: number): void {
    const level = getLevelById(id);
    if (!level) return;
    this.currentLevel = level;
    this.cleared = false;
    this.hintIndex = 0;
    this.checker.reset();
    this.clearTimers();

    this.levelManager.load(level);
    this.light.setObjectDepthLimit(this.levelManager.maxObjectZ());
    this.light.set(level.light.initial);
    this.studio.setObjects(
      level.objects,
      level.objects.map((o) => o.initial),
    );
    this.studio.projection.setTarget(this.levelManager.targetPolygons);
    this.interaction.setControls(level.controls);
    this.interaction.syncTransforms(this.levelManager.transforms);
    this.interaction.setEnabled(true);

    this.hud.setLevel(level);
    this.hud.setMoves(0);
    this.hud.setCleared(false);
    this.hud.setHintRemaining(level.hintSteps.length);

    this.showScreen('game');
    // 选中第一个物体，降低上手成本
    if (level.objects.length > 0) this.selectObject(level.objects[0].id);
    this.markDirty();
    this.refreshScore();
  }

  private resetLevel(): void {
    if (!this.currentLevel) return;
    const level = this.currentLevel;
    this.levelManager.reset();
    this.light.setObjectDepthLimit(this.levelManager.maxObjectZ());
    this.light.set(level.light.initial);
    this.interaction.syncTransforms(this.levelManager.transforms);
    for (const obj of level.objects) {
      const t = this.levelManager.transforms.get(obj.id);
      if (t) this.studio.updateTransform(obj.id, t);
    }
    this.cleared = false;
    this.checker.reset();
    this.clearTimers();
    this.hud.setMoves(0);
    this.hud.setCleared(false);
    this.hud.setMatch(0);
    this.markDirty();
    this.sound.click();
    this.refreshScore();
  }

  private nextLevel(): void {
    if (!this.currentLevel) return;
    const nextId = this.currentLevel.id + 1;
    if (nextId > TOTAL_LEVELS) {
      this.goLevels();
      return;
    }
    this.startLevel(nextId);
  }

  // ───────────────────────── 交互回调 ─────────────────────────

  private defOf(id: string): ShadowObjectDefinition | null {
    return this.currentLevel?.objects.find((o) => o.id === id) ?? null;
  }

  private selectObject(id: string): void {
    this.interaction.select(id);
  }

  private onSelect(id: string | null): void {
    const def = id ? this.defOf(id) : null;
    const t = id ? this.levelManager.transforms.get(id) : undefined;
    this.hud.setSelected(def, t);
    if (id) this.sound.click();
  }

  private rotateSelected(delta: number): void {
    this.interaction.rotateSelected(delta);
    this.sound.rotate();
  }

  private flipSelected(deg: number): void {
    this.interaction.setSelectedFlip(deg);
  }

  private setDepth(z: number): void {
    this.interaction.setSelectedDepth(z);
  }

  private setLightAxis(axis: 'x' | 'y' | 'z', value: number): void {
    this.clearTimers();
    this.light.setAxis(axis, value);
    this.hud.setLight(this.light.get(), this.light.limits());
  }

  private applyLight(s: LightState): void {
    this.levelManager.setLight(s);
    this.studio.setLightPosition(s);
    this.markDirty();
    this.scheduleCommit();
  }

  private onObjectChange(id: string, t: Transform3D): void {
    this.levelManager.setTransform(id, t);
    this.hud.setSelected(this.defOf(id), t);
    this.markDirty();
  }

  // ───────────────────────── 渲染与匹配调度 ─────────────────────────

  private markDirty(): void {
    this.projDirty = true;
    if (this.previewTimer === null) {
      this.previewTimer = window.setTimeout(() => {
        this.previewTimer = null;
        this.updatePreviewScore();
      }, PREVIEW_INTERVAL);
    }
  }

  /** 只刷新匹配度显示，不计入操作次数，也不触发通关判定 */
  private refreshScore(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    this.updatePreviewScore();
  }

  private updatePreviewScore(): void {
    if (!this.currentLevel) return;
    const iou = CompletionChecker.scoreOf(
      this.levelManager.currentMask(),
      this.levelManager.targetMask,
    );
    this.lastIou = iou;
    this.hud.setMatch(iou);
  }

  private scheduleCommit(immediate = false): void {
    if (this.commitTimer !== null) window.clearTimeout(this.commitTimer);
    if (immediate) {
      this.runCommit();
      return;
    }
    this.commitTimer = window.setTimeout(() => {
      this.commitTimer = null;
      this.runCommit();
    }, COMMIT_DEBOUNCE);
  }

  private runCommit(): void {
    if (!this.currentLevel || this.cleared) return;
    const level = this.currentLevel;
    this.levelManager.countMove();
    this.hud.setMoves(this.levelManager.moves);

    const current = this.levelManager.currentMask();
    const result = this.checker.evaluate(
      current,
      this.levelManager.targetMask,
      level.matchThreshold,
      level.excellentThreshold,
      level.masterThreshold,
      this.levelManager.moves,
      this.levelManager.hintsUsed,
      level.recommendedMoves,
    );
    this.lastIou = result.iou;
    this.hud.setMatch(result.iou);

    if (result.cleared) {
      this.onCleared(result.iou, result.rank);
      return;
    }
    // 首次达标不立即结算：稍后再做一次确认校验，避免拖动擦过阈值就弹窗
    if (result.iou >= level.matchThreshold) {
      if (this.confirmTimer !== null) window.clearTimeout(this.confirmTimer);
      this.confirmTimer = window.setTimeout(() => {
        this.confirmTimer = null;
        this.scheduleCommit(true);
      }, CONFIRM_DELAY);
    }
  }

  private onCleared(iou: number, rank: Rank): void {
    if (!this.currentLevel || rank === 'none') return;
    this.cleared = true;
    this.clearTimers();
    this.interaction.setEnabled(false);
    this.studio.projection.flash();
    this.sound.success();

    const level = this.currentLevel;
    const newRecord = this.state.recordClear(
      level.id,
      iou,
      rank,
      this.levelManager.moves,
      this.levelManager.hintsUsed,
    );
    this.hud.setCleared(true);
    this.hud.setNextEnabled(level.id < TOTAL_LEVELS);

    const modal = new ResultModal(
      {
        levelId: level.id,
        levelTitle: level.title,
        iou,
        rank,
        moves: this.levelManager.moves,
        hintsUsed: this.levelManager.hintsUsed,
        isLast: level.id >= TOTAL_LEVELS,
        newRecord,
      },
      {
        onNext: () => {
          this.closeModal();
          this.nextLevel();
        },
        onRetry: () => {
          this.closeModal();
          this.startLevel(level.id);
        },
        onBack: () => {
          this.closeModal();
          this.goLevels();
        },
      },
    );
    this.openModal(modal.root);
  }

  // ───────────────────────── 提示 ─────────────────────────

  private showHint(): void {
    if (!this.currentLevel) return;
    const level = this.currentLevel;
    if (this.hintIndex >= level.hintSteps.length) return;
    const text = level.hintSteps[this.hintIndex];
    this.hintIndex++;
    this.levelManager.hintsUsed++;
    this.hud.setHint(text);
    this.hud.setHintRemaining(level.hintSteps.length - this.hintIndex);
    this.sound.hint();
  }

  // ───────────────────────── 弹窗 ─────────────────────────

  private openModal(el: HTMLElement): void {
    this.closeModal();
    this.modal = el;
    this.hud.modalHost.append(el);
    this.interaction.setEnabled(false);
  }

  private closeModal(): void {
    if (this.modal) {
      this.modal.remove();
      this.modal = null;
    }
    if (this.screen === 'game' && !this.cleared) {
      this.interaction.setEnabled(true);
    }
  }

  private openPause(): void {
    const panel = new PausePanel(
      {
        onResume: () => this.closeModal(),
        onRestart: () => {
          this.closeModal();
          this.startLevel(this.currentLevel?.id ?? 1);
        },
        onHome: () => {
          this.closeModal();
          this.showScreen('title');
        },
        onToggleSound: (v) => {
          this.state.soundEnabled = v;
          this.sound.enabled = v;
        },
        onResetProgress: () => {
          this.state.resetProgress();
          this.closeModal();
          this.showScreen('title');
        },
      },
      this.state.soundEnabled,
    );
    this.openModal(panel.root);
  }

  // ───────────────────────── 键盘 ─────────────────────────

  private onKeyDown(e: KeyboardEvent): void {
    if (this.screen !== 'game') return;
    if (e.key === 'Escape') {
      if (this.modal) this.closeModal();
      else this.openPause();
      return;
    }
    if (this.modal) return;
    if (e.key === 'r' || e.key === 'R') {
      this.resetLevel();
    } else if (e.key === 'h' || e.key === 'H') {
      this.showHint();
    }
  }

  // ───────────────────────── 每帧 ─────────────────────────

  private onFrame(dt: number): void {
    if (this.projDirty) {
      this.studio.projection.setCurrent(this.levelManager.currentPolygons());
      this.projDirty = false;
    }
    this.studio.update(dt);
  }

  private clearTimers(): void {
    if (this.previewTimer !== null) {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = null;
    }
    if (this.commitTimer !== null) {
      window.clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    if (this.confirmTimer !== null) {
      window.clearTimeout(this.confirmTimer);
      this.confirmTimer = null;
    }
  }

  dispose(): void {
    this.clearTimers();
    window.removeEventListener('keydown', this.keyHandler);
    this.interaction.dispose();
    this.studio.dispose();
    this.sceneManager.dispose();
    this.rasterizer.dispose();
    this.sound.dispose();
  }
}
