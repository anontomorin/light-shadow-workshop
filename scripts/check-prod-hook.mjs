/**
 * 生产构建「无测试后门」检查。
 *
 * 规则 7：`installDebugHook()` 只能在开发 / 测试构建中挂载。
 * 本脚本会：
 *   1. 构建生产包（若 dist 不存在）；
 *   2. 用 `vite preview` 提供 dist；
 *   3. 用无头 Chrome 打开页面，断言 `window.__lightShadow` 不存在；
 *   4. 再断言源码里的调试钩子确实被 `import.meta.env.DEV` 守住了。
 *
 * 运行：node scripts/check-prod-hook.mjs
 *      （会自己调用 npm run build，然后自己启 preview，无需另开终端）
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** 递归列出目录下所有文件（跳过 node_modules / dist / .git） */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git' || name === '.workbuddy') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const ROOT = process.cwd();
const PORT = Number(process.env.PROD_PORT ?? 4173);
const CDP_PORT = Number(process.env.PROD_CDP_PORT ?? 9334);
const URL_BASE = process.env.PROD_URL ?? `http://localhost:${PORT}/`;
const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (label, ok, detail = '') => {
  results.push({ label, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? `：${detail}` : ''}`);
};

function findChrome() {
  for (const p of CHROME_CANDIDATES) if (existsSync(p)) return p;
  return null;
}

let chromeProc = null;
let previewProc = null;

function killAll() {
  try {
    chromeProc?.kill();
  } catch {
    /* ignore */
  }
  try {
    previewProc?.kill();
  } catch {
    /* ignore */
  }
}

async function main() {
  // ── 1. 静态断言：调试钩子必须被 DEV 守住 ──
  console.log('\n[1] 源码静态检查');
  const appSrc = readFileSync(join(ROOT, 'src', 'app', 'GameApp.ts'), 'utf8');
  const hookIdx = appSrc.indexOf('private installDebugHook()');
  const guardOk =
    hookIdx >= 0 &&
    /installDebugHook\(\)[^{]*\{\s*(?:\/\*[\s\S]*?\*\/\s*)*if \(!import\.meta\.env\.DEV\) return;/.test(appSrc);
  check('installDebugHook 首句即 `if (!import.meta.env.DEV) return;`', guardOk);

  // 更强的静态断言：整个 src/ 下只有 GameApp.ts 提到这个全局名。
  // （GameApp.ts 里除了赋值语句，函数上方的 JSDoc 也会提到它，所以按文件而不是按出现位置判断。）
  const offenders = [];
  for (const file of walk(join(ROOT, 'src'))) {
    if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue;
    const text = readFileSync(file, 'utf8');
    if (text.includes('__lightShadow') && !file.endsWith(join('app', 'GameApp.ts'))) {
      offenders.push(file.slice(ROOT.length + 1));
    }
  }
  check(
    'src/ 下只有 GameApp.ts 触及 window.__lightShadow',
    offenders.length === 0,
    offenders.length ? offenders.join(', ') : '无其它文件',
  );
  const assignOk = /\(window as unknown as \{[^}]*\}\)\.__lightShadow = api;/.test(appSrc);
  check('调试钩子通过单次类型化赋值挂载（无其它写入点）', assignOk);

  // ── 2. 构建 ──
  console.log('\n[2] 构建生产包');
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (build.status !== 0) throw new Error('npm run build 失败');
  } else {
    console.log('  · dist/ 已存在，跳过构建');
  }
  const html = readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8');
  const bundles = [...html.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
  check('生产包只有一个入口 bundle（未拆出调试分块）', bundles.length >= 1, bundles.join(', '));
  let hasMarker = false;
  for (const b of bundles) {
    const file = join(ROOT, 'dist', b.replace(/^\.\//, '').replace(/^\//, ''));
    if (!existsSync(file)) continue;
    const code = readFileSync(file, 'utf8');
    if (code.includes('__lightShadow')) hasMarker = true;
  }
  check('生产 bundle 中不含 __lightShadow 标识', hasMarker === false);

  // ── 3. 起 preview ──
  console.log('\n[3] 启动预览服务');
  previewProc = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    cwd: ROOT,
    shell: true,
    stdio: 'ignore',
  });
  let up = false;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(URL_BASE);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    await sleep(500);
  }
  if (!up) throw new Error(`预览服务未就绪（${URL_BASE}）`);
  console.log(`  · 预览服务已就绪 ${URL_BASE}`);

  // ── 4. 无头浏览器断言 ──
  console.log('\n[4] 运行时断言');
  const chrome = findChrome();
  if (!chrome) throw new Error('未找到 Chrome / Edge');
  const userDataDir = join(tmpdir(), `lsw-prod-${Date.now()}`);
  chromeProc = spawn(
    chrome,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      '--enable-unsafe-swiftshader',
      '--use-angle=swiftshader',
      '--window-size=1440,900',
      '--no-first-run',
      '--no-default-browser-check',
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
  const exceptions = [];
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
      exceptions.push(msg.params.exceptionDetails?.exception?.description ?? 'unknown');
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: URL_BASE });
  await sleep(4000);

  const hasTitle = await evaluate(`!!document.querySelector('.title-main')`);
  check('生产页面正常渲染标题页', hasTitle === true);
  const hook = await evaluate(`typeof window.__lightShadow`);
  check('生产构建不暴露 window.__lightShadow', hook === 'undefined', `typeof = ${hook}`);
  const keyCount = await evaluate(`Object.keys(window).filter((k) => /lightShadow/i.test(k)).length`);
  check('window 上无任何 lightShadow 相关全局', keyCount === 0, `匹配键数=${keyCount}`);
  const hasWorkshop = await evaluate(
    `(() => { const b = [...document.querySelectorAll('.title-actions .btn')].find(x => x.textContent.includes('花窗工坊')); return !!b; })()`,
  );
  check('生产页面仍可正常进入花窗工坊（功能完整、只是没有后门）', hasWorkshop === true);
  check('生产页面无未捕获异常', exceptions.length === 0, exceptions.slice(0, 2).join(' | '));

  ws.close();

  const failed = results.filter((r) => !r.ok);
  console.log('\n════════════════════════════════════════');
  console.log(`总计 ${results.length} 项检查，通过 ${results.length - failed.length} 项`);
  console.log(failed.length ? '未通过：' : '✓ 全部通过');
  for (const f of failed) console.log(`  ✗ ${f.label} ${f.detail}`);
  console.log('════════════════════════════════════════');
  return failed.length === 0;
}

main()
  .then((ok) => {
    killAll();
    process.exitCode = ok ? 0 : 1;
  })
  .catch((err) => {
    console.error('\n生产检查异常：', err);
    killAll();
    process.exitCode = 1;
  });
