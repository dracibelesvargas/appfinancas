/**
 * Service worker: é o que faz o app abrir sem internet (RN-001).
 *
 * Estratégia: **network-first** para o mesmo domínio. Com rede, sempre pega a versão
 * mais nova (é o que faz uma alteração aparecer sem truque); sem rede, cai no cache e o
 * app abre offline. Em localhost a ida à rede custa nada.
 *
 * (Cache-first, que eu tinha usado antes, servia o código velho mesmo depois de mudar
 * os arquivos — Ctrl+R não furava. Foi o que travou a atualização.)
 *
 * O app é local-first: os DADOS estão no OPFS, não passam por aqui. Isto guarda só o
 * código, para o app abrir offline.
 */

const VERSAO = "v21";
const CACHE = `financas-${VERSAO}`;

const CASCA = [
  "./",
  "./index.html",
  "./app.webmanifest",
  "./css/estilo.css",
  "./js/app.js",
  "./js/banco.js",
  "./js/dominio.js",
  "./js/esquema.js",
  "./js/importar-fatura.js",
  "./js/importar-extrato.js",
  "./js/importar-ofx.js",
  "./js/importar.js",
  "./js/nuvem.js",
  "./js/migrar-historico.js",
  // Ícones do app (instalação na tela inicial).
  "./icones/icone-192.png",
  "./icones/icone-512.png",
  "./icones/icone-mascara.png",
  // Vendorizados: sem eles o app não abre offline — é justamente por isso que não vêm
  // de CDN.
  "./vendor/sql-wasm.js",
  "./vendor/sql-wasm.wasm",
  "./vendor/pdf.min.mjs",
  "./vendor/pdf.worker.min.mjs",
];
/* O histórico da planilha (dados/historico-2026.json) NÃO entra no cache nem no repositório
   público: contém dados reais. Quando ausente, a migração antiga só é ignorada (o app usa o
   histórico manual). */

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CASCA)).then(() => self.skipWaiting())
  );
});

// A página pede para o SW recém-instalado assumir na hora (ver registrarServiceWorker).
self.addEventListener("message", (e) => {
  if (e.data?.tipo === "assumir") self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  // Network-first: tenta a rede, guarda no cache, e só usa o cache se a rede falhar.
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(async () => {
        const achado = await caches.match(e.request);
        if (achado) return achado;
        if (e.request.mode === "navigate") return caches.match("./index.html");
        return Response.error();
      })
  );
});
