/*
 * サービスワーカー:電波がなくても、ホーム画面から開けるようにする
 *
 * - VERSION は js/core/store.js の APP_VERSION と同じにする(tests/update.test.js で確かめる)。
 *   版を上げると、このファイルが変わったことをブラウザが見つけて、新しい版を裏で用意する。
 *   新しい版は、アプリを閉じて次に開いたとき(または「更新する」「最新版に更新」を押したとき)に入れ替わる
 * - 用意するとき:index.html を読み、そこに書いてあるスクリプトとスタイル(?v= 付き)・アイコン・manifest を
 *   キャッシュ money-tracker-<VERSION> に入れる。入れ替わったら、古い版のキャッシュを消す
 * - 画面(index.html):ネットを先に使い、つながらなければキャッシュ
 * - 同じ場所のファイル:キャッシュを先に(?v= 付きなので、版ごとに別のファイル)
 * - グラフなどの部品(jsDelivr・版を固定):キャッシュを先に(money-tracker-libs-v1)
 * - それ以外(価格取得の URL・為替・新しい版の確認 ?check=)は何もしない(そのままネットへ。キャッシュしない)
 * データ(localStorage)には触らない。
 */
const VERSION = '2026.11.05-3';
const CACHE = `money-tracker-${VERSION}`;
const LIBS = 'money-tracker-libs-v1';
const LIB_HOST = 'cdn.jsdelivr.net';
const PINNED_LIBS = /^\/npm\/(chart\.js|lz-string)@\d/; // 版を固定した部品だけ
const STATIC = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-32.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];

/** index.html に書いてあるスクリプトとスタイルの場所(同じ場所のものだけ) */
function filesIn(html) {
  const out = [];
  const re = /<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) if (!/^[a-z]+:/i.test(m[1]) && !m[1].startsWith('//')) out.push(m[1]);
  return out;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const res = await fetch('index.html', { cache: 'reload' });
      const html = await res.clone().text();
      await cache.put('index.html', res.clone());
      await cache.put('./', res);
      const files = [...new Set([...STATIC.filter((f) => f !== './' && f !== 'index.html'), ...filesIn(html)])];
      await cache.addAll(files.map((f) => new Request(f, { cache: 'reload' })));
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('money-tracker-') && k !== CACHE && k !== LIBS).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// 「更新する」「最新版に更新」から:待っている新しい版にすぐ入れ替える
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'version' && event.source) event.source.postMessage({ type: 'version', version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // グラフなどの部品(版を固定した CDN):キャッシュを先に。為替(currency-api@latest)などはとっておかない
  if (url.hostname === LIB_HOST && PINNED_LIBS.test(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(LIBS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      })()
    );
    return;
  }
  // ほかの場所(価格取得・為替・版を固定していない CDN のファイル)と、新しい版の確認は触らない
  if (url.origin !== self.location.origin || url.searchParams.has('check')) return;

  // 画面:ネットを先に。つながらなければキャッシュの index.html
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req);
          if (res.ok) cache.put('index.html', res.clone());
          return res;
        } catch (e) {
          return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
        }
      })()
    );
    return;
  }

  // 同じ場所のファイル:キャッシュを先に(無ければネットから取って入れておく)
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && url.pathname !== new URL('sw.js', self.location).pathname) cache.put(req, res.clone());
      return res;
    })()
  );
});
