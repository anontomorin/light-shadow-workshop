/**
 * 极简音效：用 WebAudio 合成轻微的点击、旋转与通关提示音。
 * 不依赖任何外部音频文件；不开启时完全静音，游戏状态也不依赖音频传达。
 */
export class SoundKit {
  private ctx: AudioContext | null = null;
  enabled = true;

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      try {
        this.ctx = new Ctor();
      } catch {
        return null;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  private tone(freq: number, duration: number, type: OscillatorType = 'sine', gain = 0.06): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.value = 0;
    env.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(env).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  click(): void {
    this.tone(520, 0.08, 'triangle', 0.05);
  }

  rotate(): void {
    this.tone(380, 0.1, 'sine', 0.045);
  }

  hint(): void {
    this.tone(660, 0.12, 'sine', 0.04);
  }

  success(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    [523.25, 659.25, 783.99].forEach((f, i) => {
      window.setTimeout(() => this.tone(f, 0.28, 'sine', 0.055), i * 110);
    });
  }

  dispose(): void {
    void this.ctx?.close();
    this.ctx = null;
  }
}
