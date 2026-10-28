/**
 * Prints de conferência dos TUBOS LANÇADORES e do DISPARO de torpedo (tela Armas, cena 3D, mapa tático).
 *
 * Uso: npm run dev (ou npx vite preview --port 4173) em outro terminal
 *      node scripts/prints/armas.mjs [url] [saida]
 * Saída: build/prints/armas/*.png
 *
 * Roteiro (uma sessão só): cenário submerso a 50 m → tela Armas → prepara os tubos 1 e 2 → portas abertas
 * na proa → dispara o tubo 1 contra o contato mais próximo (arma saindo pela boca, com e sem o corte) →
 * vista que acompanha o torpedo → acerto e arma flutuando → plotagem, mapa tático e painel da sala.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? join('build', 'prints', 'armas');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  if (sessionStorage.getItem('sx1.print.init')) return;
  sessionStorage.setItem('sx1.print.init', '1');
  localStorage.clear();
  localStorage.setItem('sx1.prefs.v2', JSON.stringify({ screen: 'armas', eng: false }));
  localStorage.setItem('sx1.quality.v1', 'alta');
  localStorage.setItem('sx1.ui.armas.vista', JSON.stringify('perspectiva'));
  localStorage.setItem('sx1.ui.armas.corte', 'false');
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
for (const t of ['Entendi', 'Descartar']) {
  const b = page.getByRole('button', { name: t, exact: true });
  if (await b.count()) await b.first().click();
}
await page.selectOption('select[aria-label="Cenário"]', 'submerso_50');
await page.getByRole('button', { name: 'Carregar', exact: true }).click();
await page.waitForTimeout(2500);

const shot = async (name, opts = {}) => {
  await page.screenshot({ path: join(OUT, `${name}.png`), ...opts });
  log('print', name);
};
const view3d = async (name) => {
  const el = page.locator('.weapons-3d');
  await el.scrollIntoViewIfNeeded();
  await el.screenshot({ path: join(OUT, `${name}.png`) });
  log('print', name);
};
const btn = (name) => page.getByRole('button', { name, exact: true });
const tube = (n) => page.locator('button.tube-card', { hasText: `Tubo ${n}` });
const setView = async (label) => page.locator('.weapons-3d .seg button', { hasText: label }).first().click();
const setCut = async (on) => {
  const cb = page.locator('.weapons-3d input[type=checkbox]');
  if ((await cb.isChecked()) !== on) await cb.click();
};
const waitText = async (loc, re, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test((await loc.textContent()) ?? '')) return true;
    await page.waitForTimeout(500);
  }
  log('tempo esgotado esperando', re);
  return false;
};

await shot('01_tela_armas');
// tubos 1 e 2: preparar (alagar, equalizar, abrir a porta)
await tube(2).click();
await btn('Preparar').click();
await tube(1).click();
const alvo = page.locator('.weapons-screen select').first();
const opts = await alvo.locator('option').allTextContents();
await alvo.selectOption({ index: 1 }); // contato mais próximo
log('alvo', opts[1]);
await btn('Preparar').click();
await btn('×20').click();
await page.getByTitle(/^Executar/).click();
await page.waitForTimeout(4000);
await shot('02_alagando');
await waitText(tube(1), /PRONTO/, 240000);
await waitText(tube(2), /PRONTO/, 60000);
await btn('×1').click();
await setView('Proa ¾');
await page.waitForTimeout(2500);
await view3d('03_portas_abertas_proa');
await shot('04_tubo_pronto');
// disparo do tubo 1: a arma sai pela boca (sem e com o corte)
await btn('Disparar').click();
await page.waitForTimeout(900);
await view3d('05_disparo_saindo');
await page.waitForTimeout(1500);
await view3d('06_disparo_fora');
await setCut(true);
await page.waitForTimeout(1500);
await view3d('07_corte_armas_nos_tubos');
await setCut(false);
// corrida acompanhada
await setView('Torpedo');
await btn('×5').click();
await page.waitForTimeout(6000);
await view3d('08_torpedo_corrida');
await btn('×20').click();
await page.waitForTimeout(8000);
await view3d('09_torpedo_guiado');
await shot('10_tela_corrida', { fullPage: true });
// acerto e flutuação
const runs = page.locator('.weapons-screen table');
await waitText(runs, /ACERTO|FLUTUANDO/, 420000);
await waitText(runs, /FLUTUANDO/, 120000);
await btn('×1').click();
await page.waitForTimeout(3000);
await view3d('11_torpedo_flutuando');
await shot('12_tela_acerto', { fullPage: true });
// mapa tático
await page.getByRole('button', { name: 'Mapa tático', exact: true }).first().click();
await page.waitForTimeout(4000);
await shot('13_mapa_tatico');
await browser.close();
