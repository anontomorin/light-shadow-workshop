import * as THREE from 'three';

/**
 * 负责 WebGL 渲染器、场景、相机与渲染循环。
 *
 * 相机使用固定的三分之四视角，只允许少量缩放，
 * 避免玩家把视角转到难以理解投影关系的位置。
 */

export const CAMERA_BASE_POSITION = new THREE.Vector3(15, 9, 17);
export const CAMERA_TARGET = new THREE.Vector3(0, 4.6, 0.5);
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 1.35;

export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private container: HTMLElement;
  private zoom = 1;
  private onFrameCallbacks: Array<(dt: number) => void> = [];
  private running = false;
  private lastTime = 0;
  private resizeObserver: ResizeObserver | null = null;
  private disposed = false;
  private cleanupFns: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#f5efe4');
    this.scene.fog = new THREE.Fog('#f5efe4', 40, 90);

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    this.applyCameraTransform();

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.classList.add('studio-canvas');

    this.resize();
    this.setupResize();
    this.setupZoom();
  }

  private applyCameraTransform(): void {
    const dir = CAMERA_BASE_POSITION.clone().sub(CAMERA_TARGET).multiplyScalar(this.zoom);
    this.camera.position.copy(CAMERA_TARGET).add(dir);
    this.camera.lookAt(CAMERA_TARGET);
    this.camera.updateProjectionMatrix();
  }

  private setupZoom(): void {
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.08 : -0.08;
      this.zoom = THREE.MathUtils.clamp(this.zoom + delta, MIN_ZOOM, MAX_ZOOM);
      this.applyCameraTransform();
    };
    this.renderer.domElement.addEventListener('wheel', handler, { passive: false });
    this.cleanupFns.push(() =>
      this.renderer.domElement.removeEventListener('wheel', handler),
    );
  }

  private setupResize(): void {
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    this.cleanupFns.push(() => window.removeEventListener('resize', onResize));

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.container);
      this.cleanupFns.push(() => this.resizeObserver?.disconnect());
    }
  }

  resize(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  onFrame(cb: (dt: number) => void): void {
    this.onFrameCallbacks.push(cb);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    const loop = () => {
      if (!this.running) return;
      const now = performance.now();
      const dt = Math.min((now - this.lastTime) / 1000, 0.1);
      this.lastTime = now;
      for (const cb of this.onFrameCallbacks) cb(dt);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** 世界坐标 → 视口像素坐标（用于自动化测试与命中提示） */
  worldToScreen(v: THREE.Vector3Like): { x: number; y: number } {
    const p = new THREE.Vector3(v.x, v.y, v.z).project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  /** 屏幕坐标 → 归一化设备坐标 */
  toNDC(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
    this.onFrameCallbacks = [];
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
    }
  }
}

/** 检测 WebGL 是否可用，用于友好降级 */
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl2') || canvas.getContext('webgl'))
    );
  } catch {
    return false;
  }
}
