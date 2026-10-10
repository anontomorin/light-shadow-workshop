/**
 * 端到端冒烟测试（Node + Chrome DevTools Protocol，无需额外依赖）。
 *
 * 验证内容：
 *   1. 页面无 JS 异常；
 *   2. WebGL 场景正常初始化（未落到降级错误页）；
 *   3. 标题页 → 关卡页 → 游戏页的流程可走通；
 *   4. 真实鼠标拖动会改变物体位置并实时刷新匹配度；
 *   5. 目标状态能够真正触发通关（走完整投影 + IoU 校验）；
 *   6. 六个关卡都能进入并渲染。
 *
 * 运行：node scripts/e2e-check.mjs   （需要先启动 npm run dev）
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const URL_BASE = process.env.E2E_URL ?? 'http://localhost:5173';
const PORT = 9333;
const OUT_DIR = join(process.cwd(), 'docs', 'shots');
/** 首屏等待：本地为毫秒级，线上经代理加载 560KB 的包可能需要十几秒 */
const BOOT_WAIT = Number(process.env.E2E_BOOT_WAIT ?? 2500);
const RELOAD_WAIT = Number(process.env.E2E_RELOAD_WAIT ?? 2400);
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    if (existsSync(p)) return p;
  }
  return null;
}

let chromeProc = null;
let ws = null;
let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const pageExceptions = [];

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}

async function evaluate(expression) {
  const res = await send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.exceptionDetails) {
    throw new Error(`evaluate 失败：${res.exceptionDetails.text} ${res.result?.description ?? ''}`);
  }
  return res.result?.value;
}

async function screenshot(name) {
  const res = await send('Page.captureScreenshot', { format: 'png' });
  const file = join(OUT_DIR, `${name}.png`);
  writeFileSync(file, Buffer.from(res.data, 'base64'));
  console.log(`  · 截图已保存 docs/shots/${name}.png`);
  return file;
}

async function mouse(type, x, y, button = 'left') {
  await send('Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button,
    buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: 1,
  });
}

/** 在渲染中插入一个可读的检查点，等待若干帧 */
const waitFrames = (n = 12) =>
  evaluate(
    `new Promise((r) => { let i = 0; const t = () => (++i >= ${n} ? r(true) : requestAnimationFrame(t)); requestAnimationFrame(t); })`,
  );

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome / Edge 可执行文件');
  console.log(`使用浏览器：${chrome}`);

  const userDataDir = join(tmpdir(), `lsw-e2e-${Date.now()}`);
  chromeProc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${PORT}`,
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--hide-scrollbars',
      '--window-size=1440,900',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${userDataDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  // 等待调试端口就绪
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
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
  console.log(`浏览器版本：${version.Browser}`);

  const listRes = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const targets = await listRes.json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('未找到页面目标');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error)})`));
      else resolve(msg.result ?? {});
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      pageExceptions.push(msg.params.exceptionDetails?.exception?.description ?? 'unknown');
    }
  });

  await send('Page.enable');
  await send('Runtime.enable');

  const results = [];
  const check = (label, ok, detail = '') => {
    results.push({ label, ok, detail });
    console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
  };

  // ── 1. 打开页面 ──────────────────────────────────────────
  console.log('\n[1] 打开页面');
  await send('Page.navigate', { url: URL_BASE });
  await sleep(BOOT_WAIT);
  await waitFrames(20);

  const hasTitle = await evaluate(`!!document.querySelector('.title-main')`);
  check('标题页渲染', hasTitle === true);
  const fatal = await evaluate(`!!document.querySelector('.fatal-error')`);
  check('未落入 WebGL 降级页', fatal === false);
  await screenshot('01-title');

  // ── 2. 标题页按钮与关卡页 ────────────────────────────────
  console.log('\n[2] 标题页与关卡选择');
  await evaluate(`document.querySelectorAll('.title-actions .btn')[1].click()`);
  await sleep(600);
  const cardCount = await evaluate(`document.querySelectorAll('.level-card').length`);
  check('关卡卡片数量为 6', cardCount === 6, `实际 ${cardCount}`);
  const lockedCount = await evaluate(`document.querySelectorAll('.level-card.locked').length`);
  check('初始仅解锁第 1 关', lockedCount === 5, `锁定 ${lockedCount} 个`);
  await screenshot('02-level-select');

  // ── 3. 进入第 1 关 ──────────────────────────────────────
  console.log('\n[3] 进入第 1 关');
  await evaluate(`document.querySelector('.level-card').click()`);
  await sleep(1800);
  await waitFrames(20);
  check('三维画布已挂载', (await evaluate(`!!document.querySelector('canvas')`)) === true);
  const webgl = await evaluate(
    `(() => { const c = document.querySelector('canvas'); if (!c) return null; return !!(c.getContext('webgl2') || c.getContext('webgl')); })()`,
  ).catch(() => null);
  check('WebGL 上下文可用', webgl === true);
  const state1 = await evaluate(`window.__lightShadow.getState()`);
  check('已进入第 1 关', state1?.levelId === 1, `levelId=${state1?.levelId}`);
  const initialIou = await evaluate(`window.__lightShadow.score()`);
  check('初始匹配度低于阈值', initialIou < 0.6, `IoU=${initialIou.toFixed(3)}`);
  const shadowMesh = await evaluate(`window.__lightShadow.getState().objects.length`);
  check('关卡物体已加载', shadowMesh === 1, `物体数=${shadowMesh}`);
  await screenshot('03-level1-initial');

  // ── 4. 真实鼠标拖动 ─────────────────────────────────────
  console.log('\n[4] 真实鼠标拖动');
  const objId = state1.objects[0].id;
  const p0 = await evaluate(`window.__lightShadow.screenPos(${JSON.stringify(objId)})`);
  const pT = await evaluate(`window.__lightShadow.targetScreenPos(${JSON.stringify(objId)})`);
  check('取得物体与目标的屏幕坐标', !!p0 && !!pT,
    p0 && pT ? `物体(${p0.x.toFixed(0)}, ${p0.y.toFixed(0)}) → 目标(${pT.x.toFixed(0)}, ${pT.y.toFixed(0)})` : 'null');

  const iouBeforeDrag = await evaluate(`window.__lightShadow.score()`);
  await mouse('mousePressed', p0.x, p0.y);
  await sleep(150);

  // 分步拖向目标，期间采样匹配度，验证"影子实时跟随"
  const steps = 26;
  const samples = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await mouse('mouseMoved', p0.x + (pT.x - p0.x) * t, p0.y + (pT.y - p0.y) * t);
    await sleep(28);
    if (i % 5 === 0) samples.push(await evaluate(`window.__lightShadow.score()`));
  }
  await mouse('mouseReleased', pT.x, pT.y);
  await sleep(1200);
  await waitFrames(12);

  const after = await evaluate(`window.__lightShadow.getState().objects[0].transform`);
  const moved = Math.abs(after.x - state1.objects[0].transform.x) > 0.05;
  check('拖动改变了物体位置', moved,
    `x: ${state1.objects[0].transform.x.toFixed(2)} → ${after.x.toFixed(2)}, y: ${state1.objects[0].transform.y.toFixed(2)} → ${after.y.toFixed(2)}`);

  const maxSample = Math.max(...samples);
  check('影子随拖动实时变化', maxSample > iouBeforeDrag,
    `拖动中匹配度采样 ${samples.map((v) => v.toFixed(2)).join(' → ')}`);

  const iouAfterDrag = await evaluate(`window.__lightShadow.score()`);
  check('用鼠标拖到目标即接近满分', iouAfterDrag > 0.9, `IoU=${iouAfterDrag.toFixed(3)}`);
  const dragModal = await evaluate(
    `document.querySelector('.modal h2') ? document.querySelector('.modal h2').textContent : null`,
  );
  check('真实鼠标操作可触发通关', !!dragModal, dragModal ?? '未弹出结算');
  await screenshot('04-after-drag');

  // ── 5. 重置与提示 ───────────────────────────────────────
  console.log('\n[5] 重置与提示系统');
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.modal .btn')].find(x => x.textContent.includes('重玩')); if (b) b.click(); })()`,
  );
  await sleep(1400);
  await waitFrames(12);
  const restartIou = await evaluate(`window.__lightShadow.score()`);
  check('重玩本关后回到初始状态', restartIou < 0.03, `IoU=${restartIou.toFixed(3)}`);

  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.game-dock .btn')].find(x => x.textContent.includes('重置')); if (b) b.click(); })()`,
  );
  await sleep(700);
  const afterResetIou = await evaluate(`window.__lightShadow.score()`);
  check('重置按钮可用', afterResetIou < 0.03, `IoU=${afterResetIou.toFixed(3)}`);

  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.game-dock .btn')].find(x => x.textContent.includes('提示')); if (b) b.click(); })()`,
  );
  await sleep(400);
  const hint = await evaluate(
    `document.querySelector('.side-hint') ? document.querySelector('.side-hint').textContent : null`,
  );
  check('提示可以显示', !!hint, hint ? hint.slice(0, 24) + '…' : '未显示');
  await screenshot('05-hint');

  // 再次通关，为"下一关"按钮验证做准备
  await evaluate(`window.__lightShadow.solve()`);
  await sleep(1500);
  await waitFrames(10);
  const backModal = await evaluate(
    `document.querySelector('.modal h2') ? document.querySelector('.modal h2').textContent : null`,
  );
  check('设置到目标状态可再次通关', !!backModal, backModal ?? '未弹出');

  // ── 6. 下一关与全部关卡渲染 ──────────────────────────────
  console.log('\n[6] 下一关与关卡遍历');
  await evaluate(
    `(() => { const b = [...document.querySelectorAll('.modal .btn')].find(x => x.textContent.includes('下一关')); if (b) b.click(); })()`,
  );
  await sleep(1500);
  await waitFrames(15);
  const state2 = await evaluate(`window.__lightShadow.getState()`);
  check('可以进入第 2 关', state2?.levelId === 2, `levelId=${state2?.levelId}`);
  const unlocked = await evaluate(`window.__lightShadow.getState().unlocked`);
  check('第 2 关已解锁', unlocked >= 2, `unlocked=${unlocked}`);
  await screenshot('06-level2');

  // ── 7. 逐关通关（验证每一关的目标状态都可解） ────────────
  console.log('\n[7] 逐关通关验证');
  for (const id of [3, 4, 5, 6]) {
    await evaluate(`window.__lightShadow.goToLevel(${id})`);
    await sleep(1200);
    await waitFrames(15);
    const st = await evaluate(`window.__lightShadow.getState()`);
    const iou = await evaluate(`window.__lightShadow.score()`);
    check(`第 ${id} 关可进入并渲染`, st?.levelId === id, `初始 IoU=${iou.toFixed(3)}`);
    await screenshot(`${String(id).padStart(2, '0')}-level${id}`);
  }

  console.log('\n[7b] 目标状态可解性与通关');
  for (const id of [1, 2, 3, 4, 5, 6]) {
    await evaluate(`window.__lightShadow.goToLevel(${id})`);
    await sleep(1100);
    await evaluate(`window.__lightShadow.solve()`);
    await sleep(1300);
    await waitFrames(12);
    const solvedIou = await evaluate(`window.__lightShadow.score()`);
    const modal = await evaluate(
      `document.querySelector('.modal h2') ? document.querySelector('.modal h2').textContent : null`,
    );
    check(`第 ${id} 关目标状态可通关`, !!modal && solvedIou > 0.98,
      `IoU=${solvedIou.toFixed(4)}${modal ? ` · ${modal}` : ' · 未弹出结算'}`);
    if (id === 6) await screenshot('07-final-result');
    // 关闭弹窗
    await evaluate(
      `(() => { const b = [...document.querySelectorAll('.modal .btn')].find(x => x.textContent.includes('返回')); if (b) b.click(); })()`,
    );
    await sleep(400);
  }

  // ── 8. 刷新后存档恢复 ───────────────────────────────────
  console.log('\n[8] 存档与刷新');
  await send('Page.navigate', { url: URL_BASE });
  await sleep(RELOAD_WAIT);
  await waitFrames(10);
  const saved = await evaluate(`window.__lightShadow.getState()`);
  check('刷新后解锁进度保留', saved.unlocked === 6, `unlocked=${saved.unlocked}`);
  const lab = await evaluate(`window.__lightShadow.getState().unlocked === 6`);
  check('全部关卡通关记录已保存', lab === true);
  await screenshot('08-after-reload');

  // ── 9. 控制台错误 ───────────────────────────────────────
  console.log('\n[9] 控制台');
  check('无页面异常', pageExceptions.length === 0, pageExceptions.join(' | '));
  check('无 console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

  const failed = results.filter((f) => !f.ok);
  console.log('\n════════════════════════════════════════');
  console.log(`总计 ${results.length} 项检查，通过 ${results.length - failed.length} 项`);
  if (failed.length) {
    console.log('未通过：');
    for (const f of failed) console.log(`  ✗ ${f.label} ${f.detail}`);
  } else {
    console.log('✓ 全部通过');
  }
  console.log('════════════════════════════════════════');

  return failed.length === 0;
}

main()
  .then((ok) => {
    if (ws) ws.close();
    if (chromeProc) chromeProc.kill();
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('\n端到端测试异常：', err);
    if (chromeProc) chromeProc.kill();
    process.exitCode = 1;
  });
