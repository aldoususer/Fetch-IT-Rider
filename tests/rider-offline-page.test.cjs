const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('offline launch uses a public fallback and never intercepts session or booking data', async () => {
  const handlers = {};
  const cached = new Map();
  const offline = new Response('Can’t connect to Fetch-It');
  let connected = true;
  const caches = {
    async open() {
      return {
        async addAll(paths) {
          for (const path of paths) cached.set(path, offline);
        },
        async match(path) { return cached.get(path); },
      };
    },
  };
  vm.runInNewContext(fs.readFileSync('public/sw.js', 'utf8'), {
    URL, AbortController, Response, caches, setTimeout, clearTimeout,
    self: {
      location: { origin: 'https://rider.test' },
      skipWaiting() {},
      addEventListener(name, callback) { handlers[name] = callback; },
    },
    async fetch() {
      if (!connected) throw new TypeError('Network unavailable');
      return new Response('Online navigation');
    },
  });
  let installed;
  handlers.install({ waitUntil(task) { installed = task; } });
  await installed;
  function request(path, mode = 'navigate', destination = 'document') {
    let response;
    handlers.fetch({
      request: { url: new URL(path, 'https://rider.test').href, method: 'GET', mode, destination },
      respondWith(task) { response = task; },
    });
    return response;
  }
  assert.equal(await (await request('/?tab=active&job=private-id')).text(), 'Online navigation');
  assert(!cached.has('/'));
  assert.equal(request('/api/auth/me'), undefined);
  assert.equal(request('/api/bookings/private-id'), undefined);
  assert.equal(request('/?tab=active&_rsc=private-id', 'cors', ''), undefined);
  connected = false;
  assert.equal(await request('/?source=pwa-shortcut-jobs'), offline);
});
