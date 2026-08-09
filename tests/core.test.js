const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../FFBypasser.user.js');

test('normalizes, filters, and deduplicates FuckingFast links in page order', () => {
  const result = api.normalizeFuckingFastLinks([
    'https://fuckingfast.co/f/alpha',
    '/not-supported',
    'https://fuckingfast.co/f/alpha#again',
    'https://www.fuckingfast.co/f/beta'
  ], 'https://fitgirl-repacks.site/post');
  assert.deepEqual(result, [
    'https://fuckingfast.co/f/alpha',
    'https://www.fuckingfast.co/f/beta'
  ]);
});

test('recovers interrupted items and retries only failures', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a', 'https://fuckingfast.co/f/b'], 'https://fitgirl-repacks.site/x', 100);
  job = api.transitionItem(job, 0, { state: 'processing' });
  job = api.transitionItem(job, 1, { state: 'failed', error: 'timeout' });
  const recovered = api.retryFailed(api.recoverJob(job));
  assert.equal(recovered.items[0].state, 'queued');
  assert.equal(recovered.items[1].state, 'queued');
  assert.equal(recovered.items[1].error, null);
});

test('summarizes completion and preserves successful results', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'https://fitgirl-repacks.site/x', 100);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn.example/a' });
  assert.deepEqual(api.summarizeJob(job), {
    total: 1, queued: 0, processing: 0, succeeded: 1, failed: 0, done: true
  });
});

test('allows the owner or an expired lease to acquire work', () => {
  const lease = api.createLease('tab-a', 1000, 5000);
  assert.equal(api.canAcquireLease(lease, 'tab-a', 2000), true);
  assert.equal(api.canAcquireLease(lease, 'tab-b', 2000), false);
  assert.equal(api.canAcquireLease(lease, 'tab-b', 6001), true);
});

test('builds an HTMX request with form, trigger, and challenge fields', () => {
  const request = api.buildRequestDescriptor({
    id: 'abc',
    pageUrl: 'https://fuckingfast.co/f/abc',
    trigger: {
      path: '/f/abc/go', target: '#result', id: 'download', name: 'go', values: { source: 'page' }
    },
    formEntries: [['mode', 'fast']],
    token: { name: 'cf-turnstile-response', value: 'token' }
  });
  assert.equal(request.path, '/f/abc/go');
  assert.equal(request.params.toString(), 'source=page&mode=fast&cf-turnstile-response=token');
  assert.equal(request.headers['HX-Target'], 'result');
});

test('formats successful direct links in original order', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a', 'https://fuckingfast.co/f/b'], 'x', 1);
  job = api.transitionItem(job, 1, { state: 'succeeded', directUrl: 'https://cdn/b' });
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  assert.equal(api.formatSuccessfulResults(job), 'https://cdn/a\nhttps://cdn/b');
});

test('storage adapter persists and clears the active job', async () => {
  const values = new Map();
  const store = api.createStore({
    getValue: async (key, fallback) => values.has(key) ? values.get(key) : fallback,
    setValue: async (key, value) => values.set(key, value),
    deleteValue: async key => values.delete(key),
    addValueChangeListener: () => 7
  });
  const job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  await store.saveJob(job);
  assert.deepEqual(await store.loadJob(), job);
  await store.clearJob();
  assert.equal(await store.loadJob(), null);
});

test('pool preserves result order while bounding concurrency', async () => {
  let active = 0;
  let peak = 0;
  const result = await api.runPool([3, 1, 2], async value => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, value));
    active -= 1;
    return value * 2;
  }, 2);
  assert.deepEqual(result, [6, 2, 4]);
  assert.equal(peak, 2);
});

