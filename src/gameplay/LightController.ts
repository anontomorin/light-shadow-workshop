import { LIGHT_LIMITS, MIN_LIGHT_GAP, clampSafe } from '../projection/Projector';

/**
 * 光源控制器：维护光源当前位置，并施加边界限制。
 *
 * 限制规则：
 *   - 光源必须停留在合法范围内；
 *   - 光源必须比所有可投影物体更靠近正 Z 端，且至少保留 MIN_LIGHT_GAP 的安全距离，
 *     否则投影公式的除数会趋近 0。
 */

export interface LightState {
  x: number;
  y: number;
  z: number;
}

export class LightController {
  private state: LightState = { x: 0, y: 5.5, z: 14 };
  private onChange: (s: LightState) => void = () => {};

  constructor(onChange: (s: LightState) => void) {
    this.onChange = onChange;
  }

  get(): LightState {
    return { ...this.state };
  }

  /** 直接设置（加载关卡 / 重置时使用） */
  set(s: LightState): void {
    this.state = this.sanitize(s);
    this.onChange(this.get());
  }

  setAxis(axis: 'x' | 'y' | 'z', value: number): void {
    const next = { ...this.state, [axis]: value } as LightState;
    this.state = this.sanitize(next);
    this.onChange(this.get());
  }

  /** 物体最靠前的深度，用于保证光源与物体的安全间距 */
  private maxObjectZ = 7;

  setObjectDepthLimit(maxZ: number): void {
    this.maxObjectZ = maxZ;
  }

  private sanitize(s: LightState): LightState {
    // 光源 z 的下界受最深物体约束
    const minZ = Math.max(LIGHT_LIMITS.minZ, this.maxObjectZ + MIN_LIGHT_GAP);
    return {
      x: clampSafe(s.x, LIGHT_LIMITS.minX, LIGHT_LIMITS.maxX, 0),
      y: clampSafe(s.y, LIGHT_LIMITS.minY, LIGHT_LIMITS.maxY, 5.5),
      z: clampSafe(s.z, minZ, LIGHT_LIMITS.maxZ, 14),
    };
  }

  /** 供 UI 显示用的当前允许范围 */
  limits() {
    return {
      ...LIGHT_LIMITS,
      minZ: Math.max(LIGHT_LIMITS.minZ, this.maxObjectZ + MIN_LIGHT_GAP),
    };
  }
}
