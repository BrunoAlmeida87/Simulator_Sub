/**
 * TESTE VISUAL AUTOMÁTICO (npm run test:visual): sobe `vite preview`, abre o simulador no Chromium já instalado, percorre as
 * cenas de scenes.mjs e compara cada captura com a referência guardada em tests/visual/imagens-esperadas/.
 * Falha se houver erro no console, canvas em branco ou diferença acima da tolerância. Relatório em test-results/visual/.
 *
 * Opções (depois de `--`):  --update            grava as capturas como novas referências
 *                           --only=id1,id2      só essas cenas (id inteiro ou prefixo, ex.: --only=03,04)
 *                           --threshold=0.1     diferença de cor por pixel que conta como "pixel diferente" (0 a 1)
 *                           --max-diff=0.01     fração máxima de pixels diferentes na imagem toda
 *                           --max-window=0.35   fração máxima de pixels diferentes dentro de qualquer janela WxW (mancha localizada)
 *                           --window=16         lado da janela, em pixels da imagem reduzida
 *                           --port=4175         porta do preview (padrão: uma livre)
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BASE_GRAPHICS, DESKTOP, SCENES } from './scenes.mjs';
import { DEFAULTS, blankStats, compare, decode, downscale2, encode } from './imagem.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REF_DIR = join(ROOT, 'tests', 'visual', 'imagens-esperadas');
const OUT_DIR = join(ROOT, 'test-results', 'visual');

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, def) => {
  const a = args.find((x) => x.startsWith(`--${n}=`));
  return a ? a.slice(n.length + 3) : def;
};
const cfg = {
  update: flag('update'),
  only: opt('only', '').split(',').filter(Boolean),
  threshold: Number(opt('threshold', DEFAULTS.threshold)),
  maxDiff: Number(opt('max-diff', DEFAULTS.maxDiff)),
  maxWindow: Number(opt('max-window', DEFAULTS.maxWindow)),
  window: Number(opt('window', DEFAULTS.window)),
  port: Number(opt('port', 0)),
};

// ------------------------------------------------------------------ servidor
function freePort() {
  return new Promise((res, rej) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
    s.on('error', rej);
  });
}

async function startPreview() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ não existe: rode `npm run build` antes (o script `npm run test:visual` já faz isso).');
  const port = cfg.port || (await freePort());
  const proc = spawn(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  proc.stdout.on('data', (d) => (log += d));
  proc.stderr.on('data', (d) => (log += d));
  const url = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error(`vite preview terminou: ${log}`);
    try {
      const r = await fetch(url);
      if (r.ok) return { proc, url };
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`vite preview não respondeu em ${url}: ${log}`);
}

// ------------------------------------------------------------------ captura
const NO_ANIM = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

async function capture(browser, url, scene) {
  const viewport = scene.viewport ?? DESKTOP;
  const ctx = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: !!scene.mobile,
    hasTouch: !!scene.mobile,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  });
  const graphics = { ...BASE_GRAPHICS, ...(scene.graphics ?? {}) };
  await ctx.addInitScript(
    ([g, ui, freezeAt]) => {
      window.__sx1TestFreeze = freezeAt;
      try {
        localStorage.setItem('sx1.graphics.v1', JSON.stringify(g));
        localStorage.setItem('sx1.quality.v1', g.quality);
        for (const [k, v] of Object.entries(ui)) localStorage.setItem(`sx1.ui.${k}`, JSON.stringify(v));
      } catch {
        /* sem armazenamento */
      }
    },
    [graphics, scene.ui ?? {}, scene.frames ?? 24],
  );
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error: ${m.text().slice(0, 300)}`);
  });
  await page.goto(`${url}#teste-visual`);
  await page.addStyleTag({ content: NO_ANIM });
  await page.waitForSelector('select', { state: 'attached', timeout: 30000 });
  // scenario: null = o cenário inicial (no celular o seletor de cenários fica no menu ☰)
  if (scene.scenario) {
    await page.locator('select').first().selectOption(scene.scenario);
    await page.getByRole('button', { name: 'Carregar', exact: true }).click();
  }
  await page.waitForTimeout(500);
  await page.keyboard.press(scene.screen);
  await page.waitForTimeout(500);
  if (scene.steps) await scene.steps(page);
  await page.addStyleTag({ content: NO_ANIM });
  await page.waitForLoadState('networkidle');
  if (scene.canvas) {
    // cada cena 3D desenha exatamente `frames` quadros desde que foi criada e congela; aqui só se espera todas congelarem
    await page.waitForSelector('canvas', { timeout: 30000 });
    await page.waitForFunction(() => window.__sx1Test.settled(), null, { timeout: 240000, polling: 250 });
  } else await page.waitForTimeout(1500);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // região do maior canvas (para a checagem de cena em branco); sem canvas, a página inteira
  const rect = await page.evaluate(() => {
    let best = null;
    for (const c of document.querySelectorAll('canvas')) {
      const r = c.getBoundingClientRect();
      if (r.width * r.height > (best ? best.width * best.height : 0) && r.bottom > 0 && r.top < innerHeight) best = { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, innerHeight - Math.max(0, r.y)) };
    }
    return best;
  });
  // a renderização por software pode demorar a entregar o quadro: prazo largo e uma segunda tentativa
  let png;
  for (let tentativa = 1; ; tentativa++) {
    try {
      png = await page.screenshot({ type: 'png', timeout: 120000 });
      break;
    } catch (e) {
      if (tentativa >= 2) throw e;
    }
  }
  const shot = decode(png);
  await ctx.close();
  const area = scene.canvas && rect ? rect : { x: 0, y: 0, width: shot.width, height: shot.height };
  return { shot, problems, blank: blankStats(shot, area), area };
}

// ------------------------------------------------------------------ execução
function maskFor(scene, w, h, factor) {
  if (!scene.mask?.length) return undefined;
  const m = new Uint8Array(w * h);
  for (const r of scene.mask)
    for (let y = Math.floor(r.y / factor); y < Math.min(h, Math.ceil((r.y + r.height) / factor)); y++) for (let x = Math.floor(r.x / factor); x < Math.min(w, Math.ceil((r.x + r.width) / factor)); x++) m[y * w + x] = 1;
  return m;
}

const pct = (v) => `${(v * 100).toFixed(2)} %`;

async function main() {
  const scenes = SCENES.filter((s) => !cfg.only.length || cfg.only.some((o) => s.id === o || s.id.startsWith(o)));
  if (!scenes.length) throw new Error(`nenhuma cena casa com --only=${cfg.only.join(',')}`);
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(REF_DIR, { recursive: true });
  const { proc, url } = await startPreview();
  const browser = await chromium.launch({
    executablePath: process.env.SX1_CHROMIUM || undefined,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const results = [];
  try {
    for (const scene of scenes) {
      const t0 = Date.now();
      const r = { id: scene.id, desc: scene.desc, status: 'ok', notes: [] };
      try {
        const cap = await capture(browser, url, scene);
        const factor = scene.downscale ?? 2;
        const act = factor === 2 ? downscale2(cap.shot) : cap.shot;
        writeFileSync(join(OUT_DIR, `${scene.id}.atual.png`), encode(act));
        if (cap.problems.length) {
          r.status = 'falhou';
          r.notes.push(...cap.problems.map((p) => `erro no navegador — ${p}`));
        }
        if (cap.blank.blank) {
          r.status = 'falhou';
          r.notes.push(`imagem em branco (desvio ${cap.blank.std.toFixed(1)}, ${cap.blank.colors} cores)`);
        }
        const refPath = join(REF_DIR, `${scene.id}.png`);
        if (cfg.update) {
          if (r.status === 'ok') {
            writeFileSync(refPath, encode(act));
            r.status = 'atualizada';
          } else r.notes.push('referência NÃO atualizada por causa dos erros acima');
        } else if (!existsSync(refPath)) {
          r.status = 'falhou';
          r.notes.push('sem referência: rode `npm run test:visual -- --update`');
        } else {
          const ref = decode(readFileSync(refPath));
          if (ref.width !== act.width || ref.height !== act.height) {
            r.status = 'falhou';
            r.notes.push(`tamanho diferente: referência ${ref.width}×${ref.height}, captura ${act.width}×${act.height}`);
          } else {
            const c = compare(ref, act, cfg, maskFor(scene, act.width, act.height, factor));
            r.diffRatio = c.ratio;
            r.windowRatio = c.windowRatio;
            writeFileSync(join(OUT_DIR, `${scene.id}.diff.png`), encode(c.diff));
            if (c.ratio > cfg.maxDiff) {
              r.status = 'falhou';
              r.notes.push(`${pct(c.ratio)} dos pixels diferentes (limite ${pct(cfg.maxDiff)})`);
            }
            if (c.windowRatio > cfg.maxWindow) {
              r.status = 'falhou';
              r.notes.push(`mancha localizada: ${pct(c.windowRatio)} de uma janela ${cfg.window}×${cfg.window} diferente (limite ${pct(cfg.maxWindow)})`);
            }
          }
        }
      } catch (e) {
        r.status = 'falhou';
        r.notes.push(`exceção: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
      }
      r.seconds = Math.round((Date.now() - t0) / 1000);
      results.push(r);
      const m = r.diffRatio !== undefined ? ` · diferença ${pct(r.diffRatio)} (janela ${pct(r.windowRatio)})` : '';
      console.log(`${r.status === 'falhou' ? '✗' : '✓'} ${r.id} — ${r.status}${m} · ${r.seconds}s`);
      for (const n of r.notes) console.log(`    ${n}`);
    }
  } finally {
    await browser.close();
    proc.kill();
  }
  writeReport(results);
  const failed = results.filter((r) => r.status === 'falhou');
  console.log(`\n${results.length - failed.length}/${results.length} cenas ok${cfg.update ? ' (referências atualizadas)' : ''} · relatório: test-results/visual/relatorio.html`);
  if (failed.length) process.exitCode = 1;
}

function writeReport(results) {
  writeFileSync(join(OUT_DIR, 'resultado.json'), JSON.stringify({ config: cfg, results }, null, 2));
  const rows = results
    .map((r) => {
      const imgs =
        r.diffRatio !== undefined
          ? `<div class="im"><figure><img src="../../tests/visual/imagens-esperadas/${r.id}.png"><figcaption>referência</figcaption></figure><figure><img src="${r.id}.atual.png"><figcaption>atual</figcaption></figure><figure><img src="${r.id}.diff.png"><figcaption>diferença (vermelho)</figcaption></figure></div>`
          : `<div class="im"><figure><img src="${r.id}.atual.png"><figcaption>atual</figcaption></figure></div>`;
      return `<section class="${r.status === 'falhou' ? 'bad' : 'good'}"><h2>${r.status === 'falhou' ? '✗' : '✓'} ${r.id} <small>${r.desc}</small></h2><p>${r.status}${r.diffRatio !== undefined ? ` · diferença ${pct(r.diffRatio)} · janela ${pct(r.windowRatio)}` : ''} · ${r.seconds}s</p>${r.notes.map((n) => `<p class="n">${n.replace(/</g, '&lt;')}</p>`).join('')}${imgs}</section>`;
    })
    .join('\n');
  writeFileSync(
    join(OUT_DIR, 'relatorio.html'),
    `<!doctype html><meta charset="utf-8"><title>Teste visual SX-1</title><style>body{font:14px system-ui;background:#0e1620;color:#dce6f0;margin:20px}section{border:1px solid #2c4a63;border-radius:6px;padding:8px 14px;margin:12px 0}.bad{border-color:#d9534f}.good{border-color:#3b8f5a}h2{margin:4px 0}small{color:#8aa}.n{color:#ffb3a8;margin:2px 0}.im{display:flex;gap:10px;flex-wrap:wrap}figure{margin:0}img{max-width:420px;border:1px solid #333}figcaption{font-size:12px;color:#8aa}</style><h1>Teste visual SX-1</h1><p>Tolerâncias: pixel ${cfg.threshold} · imagem toda ${pct(cfg.maxDiff)} · janela ${cfg.window}×${cfg.window} ${pct(cfg.maxWindow)}</p>${rows}`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(2);
});
