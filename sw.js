/* =====================================================================
 * 던전 (DunJeon) — service worker (M5 PWA)
 *
 * 전략: 캐시 우선(cache-first) + 버전 키.
 *   · install   PRECACHE 목록을 통째로 캐싱하고 곧바로 skipWaiting()
 *   · activate  CACHE 이름이 다른 옛 캐시를 전부 지우고 clients.claim()
 *     → CACHE 버전 문자열만 올리면 새 배포가 자동으로 반영된다.
 *   · fetch     GET 만 처리. 캐시에 있으면 그대로, 없으면 네트워크 후 캐시에 넣는다.
 *               내비게이션 요청은 오프라인일 때 index.html 로 폴백한다.
 *
 * 경로는 전부 상대 경로다 — sw.js 가 있는 위치(= GitHub Pages 의 /dunjeon/)를
 * 기준으로 해석되므로 하위 경로 배포에서도 그대로 동작한다.
 * =================================================================== */
'use strict';

const CACHE = 'dunjeon-v6';          // ← 배포 때 이 값을 올리면 전체 캐시가 갱신된다

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'docs/icon-192.png',
  'docs/icon-512.png',
  // js/ 15개 모듈 — index.html 의 로드 순서와 같다
  'js/roster.js',
  'js/tree.js',
  'js/core.js',
  'js/dialogue.js',
  'js/items.js',
  'js/audio.js',
  'js/mapgen.js',
  'js/monsters.js',
  'js/combat.js',
  'js/delve.js',
  'js/meta.js',
  'js/world.js',
  'js/ui.js',
  'js/draw.js',
  'js/title.js',
  'js/main.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      // 파일 하나가 404 여도 설치 자체가 실패하지 않도록 개별로 담는다
      .then(c => Promise.all(PRECACHE.map(u => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => (k === CACHE ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;    // 외부 요청은 건드리지 않는다

  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => null);
        }
        return res;
      }).catch(() => {
        // 오프라인 — 페이지 이동이면 앱 셸로 폴백
        if (req.mode === 'navigate') return caches.match('index.html');
        return Response.error();
      });
    })
  );
});

// 페이지에서 즉시 갱신을 요청할 수 있는 통로
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
