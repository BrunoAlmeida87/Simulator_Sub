/**
 * Prints de conferência do modelo 3D do SX-1 (antes = sem o .glb, casco gerado; depois = com o .glb).
 *
 * Uso: npm run build && npx vite preview --port 4173   (em outro terminal)
 *      npx playwright install chromium                (uma vez; playwright não é dependência do projeto)
 *      node scripts/prints/modelo3d.mjs [url] [saida]
 * Saída: build/prints/{antes,depois}/*.png
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:4173/';
/** URL_ANTES (opcional): servidor com a versão anterior; o "antes" usa esse site em vez de bloquear o .glb */
const URL_ANTES = process.env.URL_ANTES ?? null;
const OUT = process.argv[3] ?? join('build', 'prints');

/** preferências gravadas antes de abrir (mesmas chaves que a interface usa) */
function prefs({ screen = 'v3d', view = 'perspectiva', cut = false, dry = true, quality = 'alta', graphics = null }) {
  return {
    ...(graphics ? { 'sx1.graphics.v1': JSON.stringify({ quality, ...graphics }) } : {}),
    'sx1.prefs.v2': JSON.stringify({ screen, eng: false }),
    'sx1.quality.v1': quality,
    'sx1.ui.v3d.view': JSON.stringify(view),
    'sx1.ui.v3d.cut': JSON.stringify(cut),
    'sx1.ui.v3d.dry': JSON.stringify(dry),
    'sx1.ui.v3d.trail': 'false',
  };
}

const SHOTS = [
  { name: '01_lado', p: { view: 'perfil' }, zoom: -7 },
  { name: '02_proa_34', p: { view: 'perspectiva' } },
  { name: '03_popa_34', p: { view: 'perseguicao' }, zoom: -4 },
  { name: '04_popa_lado_baixo', p: { view: 'perseguicao' }, orbit: [120, -40], zoom: -5 },
  { name: '05_corte_tanques', p: { view: 'perfil', cut: true }, zoom: -7 },
  { name: '06_submerso', p: { view: 'perspectiva', dry: false }, scenario: 'submerso_50' },
  { name: '07_superficie', p: { view: 'perspectiva', dry: false } },
  { name: '08_estaleiro', p: { view: 'topo', dry: false }, scenario: 'base_itaguai', zoom: 5, crop: { x: 10, y: 480, width: 420, height: 410 } },
  { name: '09_celular', p: { screen: 'pilotagem', view: 'piloto', dry: false, quality: 'baixa' }, phone: true },
  { name: '10_segunda_janela', p: { view: 'perspectiva', dry: false }, visual: true },
  { name: '11_sala_pip', p: { screen: 'sala', dry: false }, buttons: ['Entendi', 'Submarino 3D'] },
  { name: '12_pick_leme', p: { screen: 'pilotagem', dry: false }, clickAt: [244, 462] },
  { name: '13_pick_snorkel', p: { screen: 'pilotagem', dry: false }, clickAt: [536, 431] },
];

let clickInfo = null;

async function shot(browser, mode, s) {
  const ctx = await browser.newContext(s.phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const glb = [];
  // no contexto inteiro: vale também para a 2ª janela
  await ctx.route('**/models/*.glb', (r) => {
    glb.push(r.request().url());
    return mode === 'antes' && !URL_ANTES ? r.abort() : r.continue();
  });
  const kv = prefs(s.p);
  await page.addInitScript((kv) => {
    if (sessionStorage.getItem('sx1.print.init')) return;
    sessionStorage.setItem('sx1.print.init', '1');
    localStorage.clear();
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, kv);
  const base = mode === 'antes' && URL_ANTES ? URL_ANTES : URL;
  await page.goto(base, { waitUntil: 'networkidle' });
  if (s.scenario) {
    await page.selectOption('select[aria-label="Cenário"]', s.scenario);
    await page.getByRole('button', { name: 'Carregar', exact: true }).click();
  }
  await page.waitForTimeout(3500);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (s.orbit && box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + s.orbit[0], cy + s.orbit[1], { steps: 25 });
    await page.mouse.up();
  }
  if (s.pan && box) {
    // arrasta a vista (botão direito = deslocar a câmera)
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(cx + s.pan[0], cy + s.pan[1], { steps: 20 });
    await page.mouse.up({ button: 'right' });
  }
  if (s.zoom && box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < Math.abs(s.zoom); i++) {
      await page.mouse.wheel(0, Math.sign(s.zoom) * 300);
      await page.waitForTimeout(60);
    }
  }
  await page.waitForTimeout(2500);
  const dir = join(OUT, mode);
  mkdirSync(dir, { recursive: true });
  let target = page;
  if (s.visual) {
    // 2ª janela (só visual), espelhando a mesma simulação pelo BroadcastChannel
    target = await ctx.newPage();
    await target.goto(base + '#visual', { waitUntil: 'networkidle' });
    await target.waitForTimeout(6000);
  }
  for (const b of s.buttons ?? []) {
    await page.getByRole('button', { name: b }).first().click();
    await page.waitForTimeout(4000);
  }
  if (s.clickAt) {
    // seleção (pick): clica na peça e mostra o painel que abriu
    await page.mouse.click(s.clickAt[0], s.clickAt[1]);
    clickInfo = s.clickAt;
    await page.waitForTimeout(1500);
  }
  await target.screenshot({ path: join(dir, `${s.name}.png`), timeout: 180000, ...(s.crop ? { clip: s.crop } : {}) });
  const logs = [];
  await ctx.close();
  return { glb: glb.length, logs };
}

// SHOTS_JSON (opcional): lista de vistas para testar enquadramentos sem editar o arquivo
if (process.env.SHOTS_JSON) SHOTS.splice(0, SHOTS.length, ...JSON.parse(process.env.SHOTS_JSON));
const MODES = process.env.MODOS ? process.env.MODOS.split(',') : ['antes', 'depois'];

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const only = process.env.SO ? process.env.SO.split(',') : null;
for (const mode of MODES) {
  for (const s of SHOTS) {
    if (only && !only.some((o) => s.name.includes(o))) continue;
    const r = await shot(browser, mode, s);
    console.log(mode, s.name, 'glb pedidos:', r.glb, clickInfo ? `clique em ${JSON.stringify(clickInfo)}` : '');
    clickInfo = null;
  }
}
await browser.close();
