import type { LevelRecord, SaveData } from '../gameplay/LevelData';
import { TOTAL_LEVELS } from '../data/levels';

const STORAGE_KEY = 'light-shadow-workshop.save.v1';
const SAVE_VERSION = 1;

/**
 * 全局存档与流程状态。
 * 只保存"少量本地数据"：解锁进度、每关最佳成绩、音效开关。
 */
export class GameState {
  private data: SaveData;

  constructor() {
    this.data = this.load();
  }

  private defaultSave(): SaveData {
    return {
      version: SAVE_VERSION,
      unlocked: 1,
      levels: {},
      soundEnabled: true,
      labUnlocked: false,
    };
  }

  private load(): SaveData {
    const fallback = this.defaultSave();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return fallback;
      const parsed = JSON.parse(raw) as Partial<SaveData>;
      if (!parsed || typeof parsed !== 'object' || parsed.version !== SAVE_VERSION) {
        return fallback;
      }
      // 逐字段校验，避免损坏的存档把游戏卡在无效状态
      const unlocked = Number.isInteger(parsed.unlocked)
        ? Math.min(TOTAL_LEVELS, Math.max(1, parsed.unlocked as number))
        : 1;
      const levels: Record<number, LevelRecord> = {};
      if (parsed.levels && typeof parsed.levels === 'object') {
        for (const [k, v] of Object.entries(parsed.levels)) {
          const id = Number(k);
          const rec = v as Partial<LevelRecord>;
          if (!Number.isInteger(id) || id < 1 || id > TOTAL_LEVELS || !rec) continue;
          levels[id] = {
            cleared: !!rec.cleared,
            bestIou: Number.isFinite(rec.bestIou) ? Math.min(1, Math.max(0, rec.bestIou as number)) : 0,
            bestRank:
              rec.bestRank === 'master' || rec.bestRank === 'excellent' || rec.bestRank === 'complete'
                ? rec.bestRank
                : 'none',
            bestMoves: Number.isFinite(rec.bestMoves) ? Math.max(0, rec.bestMoves as number) : 0,
            hintsUsed: Number.isFinite(rec.hintsUsed) ? Math.max(0, rec.hintsUsed as number) : 0,
          };
        }
      }
      return {
        version: SAVE_VERSION,
        unlocked,
        levels,
        soundEnabled: parsed.soundEnabled !== false,
        labUnlocked: !!parsed.labUnlocked,
      };
    } catch {
      return fallback;
    }
  }

  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // 隐私模式或存储不可用时静默失败，不影响游戏进行
    }
  }

  get unlocked(): number {
    return this.data.unlocked;
  }

  get soundEnabled(): boolean {
    return this.data.soundEnabled;
  }

  set soundEnabled(v: boolean) {
    this.data.soundEnabled = v;
    this.save();
  }

  get labUnlocked(): boolean {
    return this.data.labUnlocked;
  }

  isUnlocked(id: number): boolean {
    return id <= this.data.unlocked;
  }

  getRecord(id: number): LevelRecord {
    return (
      this.data.levels[id] ?? {
        cleared: false,
        bestIou: 0,
        bestRank: 'none',
        bestMoves: 0,
        hintsUsed: 0,
      }
    );
  }

  /** 记录通关结果，返回是否刷新了最佳成绩 */
  recordClear(
    id: number,
    iou: number,
    rank: 'complete' | 'excellent' | 'master',
    moves: number,
    hintsUsed: number,
  ): boolean {
    const prev = this.getRecord(id);
    const order = { none: 0, complete: 1, excellent: 2, master: 3 };
    const better = order[rank] > order[prev.bestRank] || (order[rank] === order[prev.bestRank] && iou > prev.bestIou);
    this.data.levels[id] = {
      cleared: true,
      bestIou: Math.max(prev.bestIou, iou),
      bestRank: better ? rank : prev.bestRank,
      bestMoves:
        prev.bestMoves === 0 ? moves : prev.cleared ? Math.min(prev.bestMoves, moves) : moves,
      hintsUsed: Math.max(prev.hintsUsed, hintsUsed),
    };
    if (id >= this.data.unlocked && id < TOTAL_LEVELS) {
      this.data.unlocked = id + 1;
    }
    if (Object.values(this.data.levels).filter((r) => r.cleared).length >= TOTAL_LEVELS) {
      this.data.labUnlocked = true;
    }
    this.save();
    return better;
  }

  resetProgress(): void {
    this.data = this.defaultSave();
    this.save();
  }
}
