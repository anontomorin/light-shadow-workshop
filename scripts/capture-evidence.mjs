/**
 * 证据截图采集脚本。
 *
 * 用无头 Chrome（CDP）在**真实运行的页面**上截图，全部落到 `evidence/`：
 *   1. 首屏 / 标题页（中国风，主推花窗工坊）
 *   2. 纹样图鉴（文化来源）
 *   3. 花窗工坊：步步锦 / 冰裂纹 / 三交六椀菱花 / 回纹边饰 四类纹样，
 *      以及收起两侧栏后的「专注画布」版面（三维操作区铺满整行）
 *   4. 空隙投影效果（墙面特写：影子中间确实是镂空的）
 *   5. 引导实验面板
 *   6. 自绘窗棂（用户创作）
 *   7. 导出海报（把海报管线真实产出的 PNG 落盘，而不是截屏）
 *   8. 二级入口「光影挑战」；影形解谜的关卡列表与关卡画面
 *      （含第 8 / 10 关两道经典花窗题目）
 *   9. 自由实验室：13 种形状，含十字 / 五角星 / 圆环三个带镂空的凹形
 *
 * 运行：node scripts/capture-evidence.mjs
 *      （若本地 5173 未启动，脚本会自己起 `npm run dev`）
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = process.cwd();
const OUT_DIR = join(ROOT, 'evidence');
const DEV_PORT = Number(process.env.EVIDENCE_PORT ?? 5173);
const CDP_PORT = Number(process.env.EVIDENCE_CDP_PORT ?? 9335);
const URL_BASE = process.env.EVIDENCE_URL ?? `http://localhost:${DEV_PORT}/`;
const BOOT_WAIT = Number(process.env.EVIDENCE_BOOT_WAIT ?? 3500);
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shots = [];

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

let chromeProc = null;
let devProc = null;
function cleanup() {
  try {
    chromeProc?.kill();
  } catch {
    /* ignore */
  }
  try {
    devProc?.kill();
  } catch {
    /* ignore */
  }
}

async function reachable(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1200) });
    return r.ok;
  } catch {
    return false;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  // ── 0. 确保有一个在跑的服务 ──
  if (!(await reachable(URL_BASE))) {
    console.log(`\n本地 ${URL_BASE} 未响应，启动 npm run dev …`);
    devProc = spawn('npm', ['run', 'dev', '--', '--port', String(DEV_PORT), '--strictPort'], {
      cwd: ROOT,
      shell: true,
      stdio: 'ignore',
    });
    let up = false;
    for (let i = 0; i < 80; i++) {
      if (await reachable(URL_BASE)) {
        up = true;
        break;
      }
      await sleep(500);
    }
    if (!up) throw new Error('dev 服务未能启动');
  }
  console.log(`使用页面：${URL_BASE}`);

  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome / Edge');
  console.log(`使用浏览器：${chrome}`);

  const userDataDir = join(tmpdir(), `lsw-evidence-${Date.now()}`);
  chromeProc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--window-size=1600,1000',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-http-cache',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (r.ok) {
        version = await r.json();
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  if (!version) throw new Error('Chrome 调试端口未就绪');

  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  let msgId = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result ?? {});
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.exception?.description ?? 'unknown');
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.text);
    return res.result?.value;
  };
  const waitFor = async (expr, timeoutMs = 20000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expr)) return true;
      } catch {
        /* navigating */
      }
      await sleep(200);
    }
    return false;
  };
  const waitFrames = (n = 16) =>
    evaluate(
      `new Promise((r) => { let i = 0; const t = () => (++i >= ${n} ? r(true) : requestAnimationFrame(t)); requestAnimationFrame(t); })`,
    );

  /** 全页截图 */
  const shot = async (name, label) => {
    const res = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT_DIR, `${name}.png`);
    writeFileSync(file, Buffer.from(res.data, 'base64'));
    shots.push({ name, label, file, bytes: Buffer.from(res.data, 'base64').length });
    console.log(`  · ${name}.png  ${label}`);
  };

  /** 区域截图（用于"墙面特写"这类需要裁切的画面） */
  const shotClip = async (name, label, rect, scale = 1) => {
    const res = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scale },
    });
    const buf = Buffer.from(res.data, 'base64');
    writeFileSync(join(OUT_DIR, `${name}.png`), buf);
    shots.push({ name, label, file: join(OUT_DIR, `${name}.png`), bytes: buf.length });
    console.log(`  · ${name}.png  ${label}`);
  };

  const writeBase64 = (name, label, dataUrl) => {
    const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    const buf = Buffer.from(base64, 'base64');
    writeFileSync(join(OUT_DIR, `${name}.png`), buf);
    shots.push({ name, label, file: join(OUT_DIR, `${name}.png`), bytes: buf.length });
    console.log(`  · ${name}.png  ${label}（海报管线真实产出）`);
  };

  const clickTitle = (text) =>
    evaluate(
      `(() => { const b = [...document.querySelectorAll('.title-actions .btn')].find(x => x.textContent.includes(${JSON.stringify(text)})); if (!b) return false; b.click(); return true; })()`,
    );

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1.5,
    mobile: false,
  });

  // ── 1. 首屏 ──
  console.log('\n[1] 首屏');
  await send('Page.navigate', { url: URL_BASE });
  await sleep(BOOT_WAIT);
  await waitFor(`!!window.__lightShadow`);
  await waitFrames(30);
  await shot('01-首屏', '标题页');

  // ── 2. 纹样图鉴 ──
  console.log('\n[2] 纹样图鉴');
  await clickTitle('纹样图鉴');
  await sleep(1400);
  await waitFrames(16);
  await shot('02-纹样图鉴', '纹样图鉴与文化来源');
  await evaluate(
    `(() => { const m = document.querySelector('.modal-mask .modal'); if (!m) return; const b = [...m.querySelectorAll('.btn')].find(x => x.textContent.includes('关闭')); if (b) b.click(); })()`,
  );
  await sleep(600);

  // ── 3. 花窗工坊：三类纹样 ──
  console.log('\n[3] 花窗工坊');
  await clickTitle('花窗工坊');
  await sleep(2200);
  await waitFrames(30);
  await shot('03-花窗工坊-步步锦', '步步锦模板（默认）');

  const stageRect = await evaluate(
    `(() => { const c = document.querySelector('.workshop-screen .stage canvas'); if (!c) return null; const r = c.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`,
  );
  if (stageRect) {
    await shotClip('04-空隙投影-墙面特写', '墙面影子特写（窗棂空隙被保留）', {
      x: stageRect.x + Math.round(stageRect.width * 0.12),
      y: stageRect.y + Math.round(stageRect.height * 0.12),
      width: Math.round(stageRect.width * 0.76),
      height: Math.round(stageRect.height * 0.7),
    });
  }

  const pickPattern = async (id, name, label) => {
    await evaluate(
      `(() => { const b = document.querySelector('.pattern-list .pattern-card[data-pattern="${id}"]'); if (b) b.click(); })()`,
    );
    await sleep(1100);
    await waitFrames(20);
    await shot(name, label);
  };
  await pickPattern('ice-crack-style', '05-花窗工坊-冰裂纹', '冰裂纹模板');
  await pickPattern('three-cross-six-bowl-diamond', '06-花窗工坊-三交六椀', '三交六椀菱花模板');
  await pickPattern('huiwen-border', '07-花窗工坊-回纹边饰', '回纹边饰模板');

  // 版面：收起两侧栏后三维操作区铺满整行（右上角开关随时还原）
  console.log('\n[3b] 专注画布版面');
  await evaluate(
    `(() => { for (const b of document.querySelectorAll('.stage-tools .side-toggle')) b.click(); })()`,
  );
  await sleep(900);
  await waitFrames(18);
  await shot('07b-工坊-专注画布', '收起两侧栏：三维操作区铺满整行（操作区优先）');
  await evaluate(
    `(() => { for (const b of document.querySelectorAll('.stage-tools .side-toggle')) b.click(); })()`,
  );
  await sleep(700);
  await waitFrames(12);

  // ── 4. 引导实验 ──
  console.log('\n[4] 引导实验');
  await evaluate(
    `(() => { const b = document.querySelector('.pattern-list .pattern-card[data-pattern="step-step-brocade"]'); if (b) b.click(); })()`,
  );
  await sleep(1100);
  await waitFrames(18);
  await evaluate(`(() => { const b = document.querySelector('.experiment-list .btn'); if (b) b.click(); })()`);
  await sleep(900);
  await waitFrames(14);
  // 真的改变窗格深度，让实验面板里的"基准 → 当前（变化%）"出现真实差值，
  // 截图才有说服力（否则是 +0.00）。
  await evaluate(`window.__lightShadow.workshop.setDepth(5.8)`);
  await sleep(1000);
  await waitFrames(16);
  await shot('08-引导实验面板', '引导实验：对照读数由实时投影指标推导（含真实变化百分比）');
  const expNarrative = await evaluate(
    `document.querySelector('.experiment-narrative') ? document.querySelector('.experiment-narrative').textContent.trim() : ''`,
  );
  console.log(`  · 实验叙述：${expNarrative.slice(0, 90)}…`);
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.workshop-dock .btn')].find(x => x.textContent.trim() === '重置实验'); if (b) b.click(); })()`,
  );
  await sleep(700);
  await evaluate(`window.__lightShadow.workshop.setDepth(4.2)`);
  await sleep(500);
  await waitFrames(10);

  // ── 4b. 绘制模式（真实鼠标事件驱动，展示节点标识与过程预览）──
  // 这一段同时是"进得去也出得来"的证据：进入 → 落 3 个节点 → 悬停看橡皮筋 → Esc 退出。
  // 落点不写死：先按悬停预览反查窗格局部坐标，只取真正落在窗格内部的点
  // （窗格之外的落点会被夹到边界，几个点会重合成一个节点）。
  console.log('\n[4b] 绘制模式（自绘棂条）');
  const drawBox = JSON.parse(
    await evaluate(
      `JSON.stringify((() => { const r = document.querySelector('.workshop-screen .stage').getBoundingClientRect();
        return { left: r.left, top: r.top, w: r.width, h: r.height }; })())`,
    ),
  );
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.workshop-dock .btn')].find(x => x.textContent.trim() === '画棂条'); if (b) b.click(); })()`,
  );
  await sleep(600);
  await waitFrames(10);
  const drawPts = JSON.parse(
    await evaluate(
      `JSON.stringify((() => {
        const stage = document.querySelector('.workshop-screen .stage');
        const canvas = stage.querySelector('canvas');
        const r = stage.getBoundingClientRect();
        const lab = () => ((document.querySelector('.draw-hover-label') || {}).textContent || '').split(',').map(Number);
        const cands = [];
        for (let ix = 2; ix <= 19; ix++) for (let iy = 2; iy <= 19; iy++) {
          const x = r.left + (r.width * ix) / 21, y = r.top + (r.height * iy) / 21;
          if (document.elementFromPoint(x, y) !== canvas) continue;
          stage.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerId: 31, bubbles: true }));
          const t = lab();
          if (t.length !== 2 || !isFinite(t[0]) || !isFinite(t[1])) continue;
          if (cands.some((c) => Math.abs(c.lx - t[0]) < 0.5 && Math.abs(c.ly - t[1]) < 0.5)) continue;
          cands.push({ x, y, lx: t[0], ly: t[1] });
        }
        if (!cands.length) return [];
        const maxX = Math.max(...cands.map((c) => Math.abs(c.lx)));
        const maxY = Math.max(...cands.map((c) => Math.abs(c.ly)));
        const inner = cands.filter((c) => Math.abs(c.lx) < maxX * 0.92 && Math.abs(c.ly) < maxY * 0.92);
        const pool = inner.length >= 3 ? inner : cands;
        return [pool[0], pool[Math.floor(pool.length / 2)], pool[pool.length - 1]];
      })())`,
    ),
  );
  for (const p of drawPts) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
  }
  // 悬停到一条新方向：让"下一段"的橡皮筋与真实粗细的棂条预览出现在画面里
  await send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: drawBox.left + drawBox.w * 0.46,
    y: drawBox.top + drawBox.h * 0.34,
    buttons: 1,
  });
  await sleep(600);
  await waitFrames(16);
  await shot(
    '08b-工坊-绘制模式',
    `绘制模式：${drawPts.length} 个节点带序号、当前节点有光晕与准星，虚线橡皮筋 + 按 barWidth 换算的真实棂条预览`,
  );
  // 再补一张 2× 特写：整页图里节点只有几个像素，特写才能看清"节点标识"
  if (drawPts.length) {
    const xs = drawPts.map((p) => p.x);
    const ys = drawPts.map((p) => p.y);
    const pad = 80;
    const x0 = Math.max(0, Math.min(...xs) - pad);
    const y0 = Math.max(0, Math.min(...ys) - pad);
    await shotClip(
      '08c-绘制-节点标识特写',
      '2× 特写：起点（碧玉）/ 中间节点 / 当前节点（光晕 + 十字准星 + 序号）/ 光标落点坐标',
      {
        x: x0,
        y: y0,
        width: Math.min(Math.max(...xs) + pad, 1600) - x0,
        height: Math.min(Math.max(...ys) + pad, 1000) - y0,
      },
      2,
    );
  }
  // Esc 取消折线、再 Esc 退出绘制模式（证明进得去也出得来）
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(400);
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(600);
  const drawExit = await evaluate(`window.__lightShadow.workshop.state().drawing`);
  console.log(`  · 退出绘制模式：drawing=${drawExit}`);

  // ── 5. 自绘窗棂 ──
  console.log('\n[5] 自绘窗棂');
  await evaluate(
    `window.__lightShadow.workshop.drawPolyline([{x:-1.3,y:-2.0},{x:-0.45,y:-0.4},{x:0.45,y:-2.0},{x:1.3,y:-0.4}])`,
  );
  await sleep(900);
  await waitFrames(16);
  await shot('09-自绘窗棂', '自绘棂条已并入投影');

  // ── 6. 导出海报（真实管线产出） ──
  console.log('\n[6] 导出海报');
  const poster = await evaluate(`window.__lightShadow.workshop.poster()`);
  if (poster?.dataUrl) {
    writeBase64('10-导出海报', '导出海报 1920×1080（含设计图 / 投影 / 读数）', poster.dataUrl);
  } else {
    console.log('  ! 海报渲染失败，跳过');
  }

  // ── 7. 光影挑战（二级入口）与旧玩法回归证据 ──
  console.log('\n[7] 光影挑战（二级入口）');
  await evaluate(`(() => { const b = document.querySelector('.workshop-screen .game-topbar .btn-icon'); if (b) b.click(); })()`);
  await sleep(1000);
  await clickTitle('光影挑战');
  await sleep(900);
  await waitFrames(16);
  await shot('11-二级入口-光影挑战', '二级入口：影形解谜与自由实验室收在这里');

  // ── 7a. 影形解谜（几何入门 + 花窗题目） ──
  console.log('\n[7a] 影形解谜');
  await evaluate(
    `document.querySelector('.mode-screen .mode-card.mode-levels .mode-actions .btn').click()`,
  );
  await sleep(1000);
  await waitFrames(16);
  await shot('12-影形解谜-关卡列表', '影形解谜关卡列表：几何初阶 / 花窗影谜 两组，共 10 关');
  await evaluate(`document.querySelector('.level-card').click()`);
  await sleep(2000);
  await waitFrames(24);
  await shot('13-影形解谜-第1关', '旧关卡链路：第 1 关（真实投影 + IoU 判定）');

  // 第 10 关是花窗题目总成，影子里的格眼参与判定
  await evaluate(`window.__lightShadow.goToLevel(10)`);
  await sleep(2000);
  await waitFrames(24);
  await shot('14-花窗题目-第10关', '第 10 关「窗棂总成 · 圆光窗」：窗格之间的空隙同样是判定的一部分');
  await evaluate(`window.__lightShadow.goToLevel(8)`);
  await sleep(1800);
  await waitFrames(20);
  await shot('15-花窗题目-第8关', '第 8 关「菱花窗 · 三交六椀」：用几何构件拼出经典花窗的影子');

  // 返回：关卡 → 关卡列表 → 二级入口
  await evaluate(`(() => { const b = document.querySelector('.game-topbar .btn-icon'); if (b) b.click(); })()`);
  await sleep(1000);
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.level-screen .header-actions .btn')].find(x => x.textContent.includes('返回光影挑战')); if (b) b.click(); })()`,
  );
  await sleep(800);

  // ── 7b. 自由实验室（13 种形状，含带镂空的凹形） ──
  console.log('\n[7b] 自由实验室');
  await evaluate(
    `document.querySelector('.mode-screen .mode-card.mode-lab .mode-actions .btn').click()`,
  );
  await sleep(2200);
  await waitFrames(26);
  await shot('16-自由实验室', '自由实验室：13 种形状、最多 10 个物体（原有玩法保持可用）');
  // 把三个带镂空的凹形真实加进场景：十字 / 五角星 / 圆环
  for (const shape of ['cross', 'star', 'ring']) {
    await evaluate(`window.__lightShadow.addLabShape('${shape}')`);
    await sleep(500);
  }
  await sleep(900);
  await waitFrames(20);
  await shot('17-自由实验室-镂空凹形', '十字 / 五角星 / 圆环：中空同样被如实投影');

  // ── 8. 汇总 ──
  const total = shots.reduce((s, x) => s + x.bytes, 0);
  const manifest = {
    generatedAt: new Date().toISOString(),
    url: URL_BASE,
    browser: version.Browser,
    viewport: { width: 1600, height: 1000 },
    shots: shots.map((s) => ({
      file: `evidence/${s.name}.png`,
      label: s.label,
      bytes: s.bytes,
    })),
  };
  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  console.log('\n════════════════════════════════════════');
  console.log(`共采集 ${shots.length} 张证据截图，合计 ${(total / 1024).toFixed(0)} KB`);
  console.log(`目录：evidence/  （另含 manifest.json）`);
  if (errors.length) console.log(`页面异常：${errors.slice(0, 3).join(' | ')}`);
  console.log('════════════════════════════════════════');

  ws.close();
  return errors.length === 0;
}

main()
  .then((ok) => {
    cleanup();
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('\n证据采集异常：', err);
    cleanup();
    process.exitCode = 1;
  });
