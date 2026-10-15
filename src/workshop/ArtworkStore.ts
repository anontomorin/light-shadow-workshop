import type { Transform3D } from '../gameplay/LevelData';
import type { WindowDocument } from '../patterns/types';
import { cloneDocument, validateWindowDocument } from '../window-builder/WindowDocument';

/**
 * 用户作品本地存储（与游戏存档完全分离）。
 *
 * 关键约定（开发文档 9.1）：
 *   - 使用独立 key `lightShadow.artworks.v1`，不碰原有六关存档；
 *   - 每条记录带 schemaVersion，读取时逐条校验并修复，坏数据只跳过、不白屏；
 *   - localStorage 配额溢出必须被捕获并给出可操作的提示，不能静默吞掉；
 *   - 只存纯 JSON 数据（窗格文档 + 摆放参数），不存任何 Three.js 对象。
 */

export const ARTWORK_STORAGE_KEY = 'lightShadow.artworks.v1';
const SCHEMA_VERSION = 1;
/** 单条作品体积上限（字符数）：防止把巨大的 data URI 塞进存档 */
const MAX_RECORD_CHARS = 240_000;

export interface ArtworkColors {
  wall: string;
  ink: string;
}

export interface ArtworkRecord {
  schemaVersion: 1;
  id: string;
  name: string;
  author: string;
  doc: WindowDocument;
  transform: Transform3D;
  light: { x: number; y: number; z: number };
  colors: ArtworkColors;
  createdAt: string;
  updatedAt: string;
}

export interface ArtworkSummary {
  id: string;
  name: string;
  author: string;
  updatedAt: string;
  patternId: string;
  strokeCount: number;
  segmentCount: number;
  isUserCreation: boolean;
}

export type SaveResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'quota' | 'invalid' | 'unavailable'; message: string };

interface StoreShape {
  schemaVersion: number;
  records: ArtworkRecord[];
}

function storage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function isQuotaError(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const name = (e as { name?: string }).name ?? '';
  const code = (e as { code?: number }).code;
  return (
    name === 'QuotaExceededError' ||
    name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
}

function newArtworkId(): string {
  return `art-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 读取全部记录（坏数据跳过并计数） */
export function readAll(): { records: ArtworkRecord[]; skipped: number } {
  const store = storage();
  if (!store) return { records: [], skipped: 0 };
  const raw = store.getItem(ARTWORK_STORAGE_KEY);
  if (!raw) return { records: [], skipped: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { records: [], skipped: 1 };
  }
  const shape = parsed as Partial<StoreShape>;
  if (!shape || !Array.isArray(shape.records)) return { records: [], skipped: 1 };

  const records: ArtworkRecord[] = [];
  let skipped = 0;
  for (const item of shape.records) {
    const rec = sanitizeRecord(item);
    if (rec) records.push(rec);
    else skipped++;
  }
  return { records, skipped };
}

function sanitizeRecord(raw: unknown): ArtworkRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ArtworkRecord>;
  if (r.schemaVersion !== SCHEMA_VERSION) return null;
  const validated = validateWindowDocument(r.doc);
  const t = r.transform as Partial<Transform3D> | undefined;
  const l = r.light as { x?: number; y?: number; z?: number } | undefined;
  const num = (v: unknown, fb: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fb);

  return {
    schemaVersion: 1,
    id: typeof r.id === 'string' && r.id ? r.id : newArtworkId(),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : '未命名作品',
    author: typeof r.author === 'string' ? r.author.slice(0, 24) : '',
    doc: validated.doc,
    transform: {
      x: num(t?.x, 0),
      y: num(t?.y, 5.2),
      z: num(t?.z, 3.6),
      rotationX: num(t?.rotationX, 0),
      rotationY: num(t?.rotationY, 0),
      rotationZ: num(t?.rotationZ, 0),
    },
    light: { x: num(l?.x, 0), y: num(l?.y, 5.5), z: num(l?.z, 14) },
    colors: {
      wall: typeof r.colors?.wall === 'string' ? r.colors.wall : '#fdf9f1',
      ink: typeof r.colors?.ink === 'string' ? r.colors.ink : '#31455a',
    },
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
  };
}

function writeAll(records: ArtworkRecord[]): SaveResult {
  const store = storage();
  if (!store) {
    return {
      ok: false,
      reason: 'unavailable',
      message: '当前浏览器不允许使用本地存储（可能是隐私模式），作品无法保存，但可以导出 PNG。',
    };
  }
  const payload: StoreShape = { schemaVersion: SCHEMA_VERSION, records };
  const text = JSON.stringify(payload);
  try {
    store.setItem(ARTWORK_STORAGE_KEY, text);
    return { ok: true, id: records[0]?.id ?? '' };
  } catch (e) {
    if (isQuotaError(e)) {
      return {
        ok: false,
        reason: 'quota',
        message: '本地存储空间已满，保存失败。请先导出当前作品为 PNG，或删除作品集里的一些旧作品后重试。',
      };
    }
    return {
      ok: false,
      reason: 'invalid',
      message: `保存失败：${e instanceof Error ? e.message : String(e)}。可以改用导出 PNG 保留作品。`,
    };
  }
}

export function listArtworks(): ArtworkSummary[] {
  const { records } = readAll();
  return records
    .map((r) => ({
      id: r.id,
      name: r.name,
      author: r.author,
      updatedAt: r.updatedAt,
      patternId: r.doc.patternId,
      strokeCount: r.doc.strokes.length,
      segmentCount: r.doc.strokes.reduce((n, s) => n + Math.max(0, s.points.length - 1), 0),
      isUserCreation: r.doc.isUserCreation === true || r.doc.patternId === 'custom',
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function getArtwork(id: string): ArtworkRecord | null {
  const { records } = readAll();
  const found = records.find((r) => r.id === id);
  return found ? { ...found, doc: cloneDocument(found.doc) } : null;
}

/**
 * 保存作品。传入已存在的 id 表示覆盖保存（"保存"），
 * 传入 null/新 id 表示新建（"另存为"）。
 */
export function saveArtwork(input: {
  id?: string | null;
  name: string;
  author: string;
  doc: WindowDocument;
  transform: Transform3D;
  light: { x: number; y: number; z: number };
  colors: ArtworkColors;
}): SaveResult {
  const { records } = readAll();
  const now = new Date().toISOString();
  const doc: WindowDocument = { ...cloneDocument(input.doc), name: input.name, updatedAt: now };

  const record: ArtworkRecord = {
    schemaVersion: 1,
    id: input.id ?? newArtworkId(),
    name: input.name.trim() ? input.name.trim().slice(0, 40) : '未命名作品',
    author: input.author.slice(0, 24),
    doc,
    transform: { ...input.transform },
    light: { ...input.light },
    colors: { ...input.colors },
    createdAt: records.find((r) => r.id === input.id)?.createdAt ?? now,
    updatedAt: now,
  };

  if (JSON.stringify(record).length > MAX_RECORD_CHARS) {
    return {
      ok: false,
      reason: 'invalid',
      message: '作品数据过大，无法保存。请减少自绘笔画或减小图案密度。',
    };
  }

  const idx = records.findIndex((r) => r.id === record.id);
  if (idx >= 0) records[idx] = record;
  else records.unshift(record);

  const result = writeAll(records);
  return result.ok ? { ok: true, id: record.id } : result;
}

export function deleteArtwork(id: string): boolean {
  const { records } = readAll();
  const next = records.filter((r) => r.id !== id);
  if (next.length === records.length) return false;
  return writeAll(next).ok;
}

export function clearArtworks(): boolean {
  return writeAll([]).ok;
}

/** 估计已占用的字符数，用于在界面上提示容量 */
export function usedChars(): number {
  const store = storage();
  if (!store) return 0;
  return store.getItem(ARTWORK_STORAGE_KEY)?.length ?? 0;
}
