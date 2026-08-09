const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const api = require('../FFBypasser.user.js');

test('userscript and README contain no Korean text', () => {
  const root = path.join(__dirname, '..');
  const text = [
    fs.readFileSync(path.join(root, 'FFBypasser.user.js'), 'utf8'),
    fs.readFileSync(path.join(root, 'README.md'), 'utf8')
  ].join('\n');
  assert.doesNotMatch(text, /[\uac00-\ud7a3]/);
});

test('routes supported FitGirl and FuckingFast hostnames', () => {
  assert.equal(api.routeForHostname('fitgirl-repacks.site'), 'collector');
  assert.equal(api.routeForHostname('sub.fitgirl-repacks.site'), 'collector');
  assert.equal(api.routeForHostname('www.fuckingfast.co'), 'worker');
  assert.equal(api.routeForHostname('example.com'), null);
});

test('completed panel exposes result actions and accurate progress', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  const view = api.panelViewModel(job);
  const html = api.renderPanelMarkup(view);
  assert.equal(view.percent, 100);
  assert.match(html, /Copy/);
  assert.match(html, /Download TXT/);
  assert.match(html, /1\/1/);
});

test('hidden worker frames remain renderable for challenge widgets', () => {
  const style = api.frameStyleForVisibility(false);
  assert.doesNotMatch(style, /display\s*:\s*none/i);
  assert.match(style, /opacity\s*:\s*0/i);
  assert.match(style, /pointer-events\s*:\s*none/i);
});

test('active worker view exposes clear status and current item', () => {
  let job = api.createJob(['https://fuckingfast.co/f/current-file'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'processing' });
  const view = api.panelViewModel(job, 'worker');
  assert.equal(view.isActive, true);
  assert.equal(view.statusKind, 'active');
  assert.equal(view.statusLabel, 'Working');
  assert.equal(view.currentItemLabel, 'current-file');
});

test('collector markup has one primary action and no concurrency control', () => {
  const html = api.renderPanelMarkup(api.panelViewModel(null, 'collector'));
  assert.match(html, /Extract Direct Links/);
  assert.doesNotMatch(html, /data-field="concurrency"/);
  assert.doesNotMatch(html, /Concurrency/);
});

test('active worker markup contains the HUD activity elements', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'processing' });
  const html = api.renderPanelMarkup(api.panelViewModel(job, 'worker'));
  assert.match(html, /ff-panel status-active/);
  assert.match(html, /status-ring/);
  assert.match(html, /hero-count/);
  assert.match(html, /activity-grid/);
  assert.match(html, /collapsed-status/);
});

test('panel CSS includes activity motion and reduced-motion fallback', () => {
  const css = api.panelStyles();
  assert.match(css, /@keyframes\s+ff-spin/);
  assert.match(css, /@keyframes\s+ff-pulse/);
  assert.match(css, /@keyframes\s+ff-sheen/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
});

test('successful worker view hides all result actions', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  const html = api.renderPanelMarkup(api.panelViewModel(job, 'worker'));
  assert.match(html, /status-success/);
  assert.match(html, /Complete/);
  assert.doesNotMatch(html, />Copy</);
  assert.doesNotMatch(html, /Download TXT/);
  assert.doesNotMatch(html, />Clear</);
});

test('failed worker view keeps retry but hides result actions', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a', 'https://fuckingfast.co/f/b'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  job = api.transitionItem(job, 1, { state: 'failed', error: 'HTTP 500' });
  const html = api.renderPanelMarkup(api.panelViewModel(job, 'worker'));
  assert.match(html, /Retry failed/);
  assert.doesNotMatch(html, />Copy</);
  assert.doesNotMatch(html, /Download TXT/);
  assert.doesNotMatch(html, />Clear</);
});

test('completed collector view directs the user to download', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  const html = api.renderPanelMarkup(api.panelViewModel(job, 'collector'));
  assert.match(html, /Ready to download/);
  assert.match(html, />Copy</);
  assert.match(html, /Download TXT/);
  assert.match(html, />Clear</);
});

