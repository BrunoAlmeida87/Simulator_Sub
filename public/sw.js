/*
 * Service worker do SX-1 (uso offline e instalação como aplicativo).
 *  - Página (navegação): rede primeiro; sem rede, a última versão guardada.
 *  - Arquivos com hash do build (assets/): cache primeiro (um build novo tem nomes novos; os antigos saem
 *    quando o limite de itens é passado). Modelos, texturas e ícones: devolve o guardado e atualiza em segundo plano.
 * Só para http(s) — no executável (file://) e no servidor de desenvolvimento não é registrado.
 */
const CACHE = 'sx1-v1';
const MAX_ITEMS = 500;

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest']).catch(() => undefined)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ITEMS; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // mapas e serviços externos: direto da rede
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./'))),
    );
    return;
  }
  const save = (res) => {
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy).then(() => trim(c)));
    }
    return res;
  };
  // assets/ têm hash no nome (nunca mudam): cache primeiro. Os demais (modelos, texturas, ícones) podem ser
  // atualizados no site com o mesmo nome: devolve o guardado e atualiza em segundo plano.
  const hashed = url.pathname.includes('/assets/');
  ev.respondWith(
    caches.match(req).then((hit) => {
      if (hit && hashed) return hit;
      const net = fetch(req).then(save);
      return hit ? (net.catch(() => hit), hit) : net;
    }),
  );
});
