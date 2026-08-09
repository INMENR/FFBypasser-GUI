// ==UserScript==
// @name         FFBypasser for Violentmonkey
// @namespace    local.ffbypasser
// @version      1.0.1
// @updateURL    https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js
// @downloadURL  https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js
// @description  Collect and resolve FuckingFast links from FitGirl pages.
// @match        https://fitgirl-repacks.site/*
// @match        https://*.fitgirl-repacks.site/*
// @match        https://fuckingfast.co/*
// @match        https://*.fuckingfast.co/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        GM_setClipboard
// @grant        GM_download
// @run-at       document-idle
// ==/UserScript==

'use strict';

const CONFIG = Object.freeze({
  concurrency: 2,
  delayMs: 800,
  pageTimeoutMs: 30000,
  tokenWaitMs: 12000,
  captureTimeoutMs: 20000,
  showFrames: false,
  verboseFirst: false,
  leaseTtlMs: 15000
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isFuckingFastHostname(hostname) {
  return /(^|\.)fuckingfast\.co$/i.test(hostname);
}

function normalizeFuckingFastLinks(hrefs, baseUrl) {
  const seen = new Set();
  const result = [];
  for (const href of hrefs) {
    try {
      const url = new URL(href, baseUrl);
      if (!isFuckingFastHostname(url.hostname)) continue;
      url.hash = '';
      if (seen.has(url.href)) continue;
      seen.add(url.href);
      result.push(url.href);
    } catch {}
  }
  return result;
}

function fileIdOf(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  return parts.at(-1) || '';
}

function createJob(links, sourceUrl, now = Date.now()) {
  return {
    schemaVersion: 1,
    id: `${now}-${Math.random().toString(36).slice(2, 10)}`,
    sourceUrl,
    createdAt: now,
    updatedAt: now,
    config: { concurrency: CONFIG.concurrency },
    items: links.map(link => ({
      link,
      state: 'queued',
      directUrl: null,
      error: null
    }))
  };
}

function transitionItem(job, index, patch) {
  if (!job || !job.items || !job.items[index]) throw new RangeError(`Invalid item index: ${index}`);
  const next = clone(job);
  next.items[index] = { ...next.items[index], ...patch };
  next.updatedAt = Date.now();
  return next;
}

function recoverJob(job) {
  if (!job) return null;
  const next = clone(job);
  next.items = next.items.map(item => item.state === 'processing'
    ? { ...item, state: 'queued', error: null }
    : item);
  return next;
}

function retryFailed(job) {
  const next = clone(job);
  next.items = next.items.map(item => item.state === 'failed'
    ? { ...item, state: 'queued', error: null, directUrl: null }
    : item);
  next.updatedAt = Date.now();
  return next;
}

function summarizeJob(job) {
  const summary = { total: 0, queued: 0, processing: 0, succeeded: 0, failed: 0, done: false };
  if (!job) return summary;
  summary.total = job.items.length;
  for (const item of job.items) {
    if (Object.hasOwn(summary, item.state)) summary[item.state] += 1;
  }
  summary.done = summary.total > 0 && summary.queued === 0 && summary.processing === 0;
  return summary;
}

function createLease(owner, now = Date.now(), ttlMs = CONFIG.leaseTtlMs) {
  return { owner, expiresAt: now + ttlMs };
}

function canAcquireLease(lease, owner, now = Date.now()) {
  return !lease || lease.owner === owner || lease.expiresAt < now;
}

function buildRequestDescriptor({ id, pageUrl, trigger = {}, formEntries = [], token = null }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(trigger.values || {})) params.set(key, String(value));
  for (const [key, value] of formEntries) params.set(key, String(value));
  if (token && token.name && token.value) params.set(token.name, token.value);

  const headers = {
    'HX-Request': 'true',
    'HX-Current-URL': pageUrl,
    'Content-Type': 'application/x-www-form-urlencoded'
  };
  if (trigger.target) headers['HX-Target'] = trigger.target.replace(/^#/, '');
  if (trigger.id) headers['HX-Trigger'] = trigger.id;
  if (trigger.name) headers['HX-Trigger-Name'] = trigger.name;
  return { path: trigger.path || `/f/${id}/go`, params, headers };
}

function readRedirect(headers) {
  if (!headers) return null;
  const get = typeof headers.get === 'function'
    ? name => headers.get(name)
    : name => headers[name] || headers[name.toLowerCase()] || null;
  return get('hx-redirect') || get('HX-Redirect') || get('hx-location') || get('location');
}

function formatSuccessfulResults(job) {
  if (!job) return '';
  return job.items
    .filter(item => item.state === 'succeeded' && item.directUrl)
    .map(item => item.directUrl)
    .join('\n');
}

const STORAGE_KEYS = Object.freeze({
  job: 'ffbypasser.activeJob.v1',
  lease: 'ffbypasser.workerLease.v1'
});

function createStore(gm) {
  return {
    loadJob: () => gm.getValue(STORAGE_KEYS.job, null),
    saveJob: job => gm.setValue(STORAGE_KEYS.job, job),
    clearJob: () => gm.deleteValue(STORAGE_KEYS.job),
    loadLease: () => gm.getValue(STORAGE_KEYS.lease, null),
    saveLease: lease => lease
      ? gm.setValue(STORAGE_KEYS.lease, lease)
      : gm.deleteValue(STORAGE_KEYS.lease),
    clearAll: async () => {
      await gm.deleteValue(STORAGE_KEYS.job);
      await gm.deleteValue(STORAGE_KEYS.lease);
    },
    watchJob: callback => gm.addValueChangeListener(
      STORAGE_KEYS.job,
      (_key, oldValue, newValue, remote) => callback(newValue, oldValue, remote)
    )
  };
}

async function runPool(items, worker, size) {
  const output = new Array(items.length);
  let cursor = 0;
  const laneCount = Math.min(items.length, Math.max(1, Number(size) || 1));
  const lanes = Array.from({ length: laneCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return output;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function absolutize(url, origin) {
  try { return new URL(url, origin).href; } catch { return url; }
}

function tokenWidgetPresent(win) {
  return Boolean(win.document.querySelector(
    '.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"]'
  ));
}

function grabToken(win) {
  const input = win.document.querySelector(
    'input[name="cf-turnstile-response"], input[name="g-recaptcha-response"], input[name="h-captcha-response"]'
  );
  if (input?.value) return { name: input.name, value: input.value };
  try {
    const value = win.turnstile?.getResponse?.();
    if (value) return { name: 'cf-turnstile-response', value };
  } catch {}
  return null;
}

async function waitForToken(win) {
  if (!tokenWidgetPresent(win)) return null;
  const deadline = Date.now() + CONFIG.tokenWaitMs;
  while (Date.now() < deadline) {
    const token = grabToken(win);
    if (token) return token;
    await sleep(250);
  }
  return grabToken(win);
}

function findTrigger(win, id) {
  const doc = win.document;
  return doc.querySelector(`[hx-post*="/${CSS.escape(id)}/"], [hx-post], [data-hx-post]`)
    || Array.from(doc.querySelectorAll('a,button')).find(node => /download/i.test(node.textContent || ''))
    || null;
}

function inspectRequest(win, id, token) {
  const triggerNode = findTrigger(win, id);
  const valuesText = triggerNode?.getAttribute('hx-vals') || triggerNode?.getAttribute('data-hx-vals');
  let values = {};
  if (valuesText) {
    try { values = JSON.parse(valuesText); } catch {}
  }
  const form = triggerNode?.closest('form') || win.document.querySelector('form');
  const formEntries = form
    ? Array.from(new win.FormData(form).entries()).filter(([, value]) => typeof value === 'string')
    : [];
  return {
    descriptor: buildRequestDescriptor({
      id,
      pageUrl: win.location.href,
      trigger: {
        path: triggerNode?.getAttribute('hx-post') || triggerNode?.getAttribute('data-hx-post') || `/f/${id}/go`,
        target: triggerNode?.getAttribute('hx-target') || triggerNode?.getAttribute('data-hx-target'),
        id: triggerNode?.id || '',
        name: triggerNode?.getAttribute('name') || '',
        values
      },
      formEntries,
      token
    }),
    triggerNode
  };
}

async function strategyFast(link, id) {
  const origin = new URL(link).origin;
  const response = await fetch(`${origin}/f/${encodeURIComponent(id)}/go`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'HX-Request': 'true',
      'HX-Current-URL': link,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: ''
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const redirect = readRedirect(response.headers);
  if (!redirect) throw new Error('missing redirect');
  return absolutize(redirect, origin);
}

function frameStyleForVisibility(visible) {
  return visible
    ? 'position:fixed;right:12px;bottom:190px;width:420px;height:280px;z-index:2147483646;background:#111;border:1px solid #555'
    : 'position:fixed;left:-500px;top:0;width:420px;height:280px;opacity:0;pointer-events:none;border:0';
}

async function loadFrame(link) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = frameStyleForVisibility(CONFIG.showFrames);
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      frame.remove();
      reject(new Error('page load timeout'));
    }, CONFIG.pageTimeoutMs);
    frame.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(frame);
    };
    frame.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      frame.remove();
      reject(new Error('frame load error'));
    };
    frame.src = link;
    document.body.appendChild(frame);
  });
}

function readableFrameWindow(frame) {
  try {
    const win = frame.contentWindow;
    void win.location.href;
    return win.document.body ? win : null;
  } catch {
    return null;
  }
}

function neuterAds(win) {
  try { win.open = () => null; } catch {}
}

async function strategyPageFetch(win, id) {
  const token = await waitForToken(win);
  const { descriptor } = inspectRequest(win, id, token);
  const response = await win.fetch(descriptor.path, {
    method: 'POST',
    credentials: 'include',
    headers: descriptor.headers,
    body: descriptor.params.toString()
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const redirect = readRedirect(response.headers);
  if (redirect) return absolutize(redirect, win.location.origin);
  const body = await response.text();
  const match = body.match(/https?:\/\/[^\s"'<>\\]+/);
  if (!match) throw new Error('missing redirect');
  return match[0];
}

function armCapture(win) {
  let resolveCapture;
  const promise = new Promise(resolve => { resolveCapture = resolve; });
  const cleanups = [];
  try {
    const originalFetch = win.fetch;
    win.fetch = (...args) => originalFetch(...args).then(response => {
      const redirect = readRedirect(response.headers);
      if (redirect) resolveCapture(redirect);
      return response;
    });
    cleanups.push(() => { win.fetch = originalFetch; });
  } catch {}
  try {
    const prototype = win.XMLHttpRequest.prototype;
    const originalOpen = prototype.open;
    prototype.open = function (...args) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4) return;
        const redirect = this.getResponseHeader('hx-redirect') || this.getResponseHeader('hx-location');
        if (redirect) resolveCapture(redirect);
      });
      return originalOpen.apply(this, args);
    };
    cleanups.push(() => { prototype.open = originalOpen; });
  } catch {}
  return { promise, cleanup: () => cleanups.forEach(fn => fn()) };
}

async function strategyClick(win, id) {
  neuterAds(win);
  await waitForToken(win);
  const trigger = findTrigger(win, id);
  if (!trigger) throw new Error('download control not found');
  const capture = armCapture(win);
  try {
    trigger.click();
    await sleep(700);
    trigger.click();
    const redirect = await Promise.race([
      capture.promise,
      sleep(CONFIG.captureTimeoutMs).then(() => null)
    ]);
    if (!redirect) throw new Error('click redirect timeout');
    return absolutize(redirect, win.location.origin);
  } finally {
    capture.cleanup();
  }
}

async function resolveLink(link) {
  const id = fileIdOf(link);
  const errors = [];
  try {
    return { directUrl: await strategyFast(link, id), error: null };
  } catch (error) {
    errors.push(`fast: ${error.message}`);
  }

  let frame = null;
  try {
    frame = await loadFrame(link);
    const win = readableFrameWindow(frame);
    if (!win) throw new Error('frame blocked');
    neuterAds(win);
    try {
      return { directUrl: await strategyPageFetch(win, id), error: null };
    } catch (error) {
      errors.push(`page: ${error.message}`);
    }
    try {
      return { directUrl: await strategyClick(win, id), error: null };
    } catch (error) {
      errors.push(`click: ${error.message}`);
    }
  } catch (error) {
    errors.push(`load: ${error.message}`);
  } finally {
    frame?.remove();
  }

  if (new URL(location.href).pathname !== new URL(link).pathname) {
    location.href = link;
    return { directUrl: null, error: 'worker navigating to file page', navigating: true };
  }
  try {
    return { directUrl: await strategyPageFetch(window, id), error: null };
  } catch (error) {
    errors.push(`current page: ${error.message}`);
  }
  try {
    return { directUrl: await strategyClick(window, id), error: null };
  } catch (error) {
    errors.push(`current click: ${error.message}`);
  }
  return { directUrl: null, error: errors.join(' | ') };
}

async function runWorker(store, owner, onUpdate = () => {}) {
  const lease = await store.loadLease();
  if (!canAcquireLease(lease, owner)) return false;
  await store.saveLease(createLease(owner));
  const renewal = setInterval(() => store.saveLease(createLease(owner)).catch(() => {}), 5000);
  try {
    let job = recoverJob(await store.loadJob());
    if (!job) return false;
    await store.saveJob(job);
    const indices = job.items.map((item, index) => item.state === 'queued' ? index : -1).filter(index => index >= 0);
    await runPool(indices, async index => {
      let current = await store.loadJob();
      if (!current || current.id !== job.id || current.items[index].state !== 'queued') return;
      current = transitionItem(current, index, { state: 'processing', error: null });
      await store.saveJob(current);
      onUpdate(current);
      const result = await resolveLink(current.items[index].link);
      if (result.navigating) return;
      current = await store.loadJob();
      if (!current || current.id !== job.id) return;
      current = transitionItem(current, index, result.directUrl
        ? { state: 'succeeded', directUrl: result.directUrl, error: null }
        : { state: 'failed', directUrl: null, error: result.error });
      await store.saveJob(current);
      onUpdate(current);
      await sleep(CONFIG.delayMs);
    }, job.config?.concurrency || CONFIG.concurrency);
    return true;
  } finally {
    clearInterval(renewal);
    const latest = await store.loadLease();
    if (latest?.owner === owner) await store.saveLease(null);
  }
}

function routeForHostname(hostname) {
  if (/(^|\.)fitgirl-repacks\.site$/i.test(hostname)) return 'collector';
  if (isFuckingFastHostname(hostname)) return 'worker';
  return null;
}

function panelViewModel(job, role = 'collector', message = '') {
  const summary = summarizeJob(job);
  const completed = summary.succeeded + summary.failed;
  const percent = summary.total ? Math.round((completed / summary.total) * 100) : 0;
  let statusKind = 'idle';
  let statusLabel = 'Ready';
  if (job) {
    if (summary.processing) {
      statusKind = 'active';
      statusLabel = 'Working';
    } else if (summary.failed) {
      statusKind = 'warning';
      statusLabel = 'Partial Failure';
    } else if (summary.done) {
      statusKind = 'success';
      statusLabel = 'Complete';
    } else {
      statusKind = 'queued';
      statusLabel = 'Queued';
    }
  }
  const currentItem = job?.items.find(item => item.state === 'processing')
    || job?.items.find(item => item.state === 'queued')
    || null;
  let currentItemLabel = '';
  if (currentItem) {
    try { currentItemLabel = fileIdOf(currentItem.link); } catch { currentItemLabel = currentItem.link; }
  }
  const isActive = Boolean(job && (summary.processing || summary.queued));
  const phase = job
    ? `${statusLabel} - ${summary.succeeded} succeeded - ${summary.failed} failed`
    : role === 'collector' ? 'Extract FuckingFast links in one pass' : 'Waiting for a saved job';
  return {
    job, role, message, summary, completed, percent, phase,
    isActive, statusKind, statusLabel, currentItemLabel
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function renderPanelMarkup(view) {
  const { job, role, summary, percent, message, statusKind, statusLabel, currentItemLabel, isActive } = view;
  const actions = [];
  if (!job && role === 'collector') actions.push('<button class="primary-start" data-action="start">Extract Direct Links</button>');
  if (job && summary.succeeded) {
    actions.push('<button data-action="copy">Copy</button>');
    actions.push('<button data-action="download">Download TXT</button>');
  }
  if (job && summary.failed) actions.push('<button data-action="retry">Retry failed</button>');
  if (job) actions.push('<button class="muted" data-action="clear">Clear</button>');
  const header = `
    <header>
      <div class="brand-block">
        <span class="status-dot" aria-hidden="true"></span>
        <div><strong>FFBypasser</strong><span class="status-label">${escapeHtml(statusLabel)}</span></div>
      </div>
      <div class="header-tools">
        <span class="collapsed-status">${job ? `${view.completed}/${summary.total}` : 'READY'}</span>
        <button class="collapse" data-action="collapse" title="Collapse panel">-</button>
      </div>
    </header>`;

  if (role === 'collector' && !job) {
    return `<div class="ff-panel status-${statusKind} role-collector">
      ${header}
      <main class="collector-main">
        <div class="collector-icon" aria-hidden="true">&#8599;</div>
        <h2>Direct links in one pass</h2>
        <p class="helper">Collect FuckingFast links and process them automatically in a dedicated worker tab.</p>
        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ''}
        <div class="actions">${actions.join('')}</div>
      </main>
    </div>`;
  }

  const ringContent = statusKind === 'success' ? '&#10003;' : statusKind === 'warning' && !isActive ? '!' : '';
  return `<div class="ff-panel status-${statusKind} role-${role}${isActive ? ' is-active' : ''}">
    ${header}
    <main>
      <div class="worker-hero">
        <div class="status-ring" aria-hidden="true"><span>${ringContent}</span></div>
        <div class="hero-copy">
          <div class="eyebrow">${escapeHtml(statusLabel)}</div>
          <div class="hero-count">${view.completed}/${summary.total}<small>${percent}%</small></div>
        </div>
      </div>
      <div class="current-item" title="${escapeHtml(currentItemLabel)}">
        <span>Current item</span><strong>${escapeHtml(currentItemLabel || (summary.done ? 'All items processed' : 'Preparing job'))}</strong>
      </div>
      <div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}">
        <i style="width:${percent}%"></i>
      </div>
      <div class="activity-grid">
        <div><span>Queued</span><strong>${summary.queued}</strong></div>
        <div class="ok"><span>Success</span><strong>${summary.succeeded}</strong></div>
        <div class="bad"><span>Failed</span><strong>${summary.failed}</strong></div>
      </div>
      ${message ? `<div class="message">${escapeHtml(message)}</div>` : ''}
      <div class="actions">${actions.join('')}</div>
    </main>
  </div>`;
}

function panelStyles() {
  return `
    :host{color-scheme:dark;--cyan:#22d3ee;--green:#4ade80;--red:#fb7185;--ink:#070b12;--panel:#10151f;--line:#2a3443}
    *{box-sizing:border-box}
    section{width:360px;color:#f8fafc;font:13px/1.45 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif}
    .ff-panel{overflow:hidden;border:1px solid var(--line);border-radius:16px;background:linear-gradient(155deg,#151c28 0%,#0b1018 100%);box-shadow:0 22px 70px #000b;transition:border-color .25s ease,box-shadow .25s ease,transform .25s ease}
    .ff-panel.is-active{border-color:#22d3eeaa;box-shadow:0 0 0 1px #22d3ee24,0 0 34px #22d3ee25,0 24px 70px #000d}
    .ff-panel.status-success{border-color:#4ade8075;animation:ff-complete .5s cubic-bezier(.2,.8,.2,1)}
    .ff-panel.status-warning{border-color:#fb718575;box-shadow:0 0 28px #fb718516,0 22px 70px #000b}
    header{display:flex;align-items:center;justify-content:space-between;min-height:58px;padding:11px 13px;border-bottom:1px solid #ffffff0d;background:#ffffff05}
    .brand-block,.header-tools{display:flex;align-items:center;gap:10px}.brand-block>div{display:flex;flex-direction:column}.brand-block strong{font-size:14px;letter-spacing:.01em}.status-label{color:#93a4ba;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .status-dot{width:10px;height:10px;border-radius:50%;background:#64748b;box-shadow:0 0 0 4px #64748b18}
    .status-active .status-dot,.status-queued .status-dot,.is-active .status-dot{background:var(--cyan);box-shadow:0 0 14px var(--cyan);animation:ff-pulse 1.35s ease-in-out infinite}
    .status-success .status-dot{background:var(--green);box-shadow:0 0 12px #4ade8080}.status-warning .status-dot{background:var(--red);box-shadow:0 0 12px #fb718580}
    .collapsed-status{min-width:48px;padding:4px 7px;border:1px solid #ffffff14;border-radius:999px;color:#cbd5e1;background:#ffffff08;text-align:center;font:700 11px/1 ui-monospace,SFMono-Regular,monospace}
    button{border:0;border-radius:9px;padding:8px 11px;color:#04120b;background:var(--green);font:750 12px system-ui;cursor:pointer;transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}button:hover{filter:brightness(1.08);transform:translateY(-1px)}button:active{transform:translateY(0)}button.muted,.collapse{color:#e2e8f0;background:#ffffff0d}.collapse{min-width:29px;padding:5px 8px}
    main{padding:15px}.worker-hero{display:flex;align-items:center;gap:15px;padding:4px 2px 14px}.status-ring{position:relative;display:grid;place-items:center;width:66px;height:66px;flex:0 0 66px;border:3px solid #334155;border-top-color:#64748b;border-radius:50%;color:var(--green);font-size:26px;font-weight:900}.status-active .status-ring{border-color:#164e63;border-top-color:var(--cyan);box-shadow:inset 0 0 18px #22d3ee12,0 0 22px #22d3ee1c;animation:ff-spin 1.05s linear infinite}.status-active .status-ring span{animation:ff-counter-spin 1.05s linear infinite}.status-queued .status-ring{border-color:#164e63;border-top-color:var(--cyan)}.status-success .status-ring{border-color:var(--green);background:#4ade8010;box-shadow:0 0 24px #4ade8024}.status-warning .status-ring{border-color:var(--red);color:var(--red);background:#fb718510}
    .hero-copy{min-width:0}.eyebrow{margin-bottom:2px;color:var(--cyan);font-size:11px;font-weight:850;letter-spacing:.12em}.status-success .eyebrow{color:var(--green)}.status-warning .eyebrow{color:var(--red)}.hero-count{display:flex;align-items:baseline;gap:9px;font-size:29px;font-weight:850;letter-spacing:-.04em}.hero-count small{color:#94a3b8;font-size:13px;font-weight:750;letter-spacing:0}
    .current-item{min-width:0;margin-bottom:11px;padding:10px 11px;border:1px solid #ffffff0c;border-radius:10px;background:#02061770}.current-item span{display:block;margin-bottom:2px;color:#64748b;font-size:10px;font-weight:800;letter-spacing:.09em}.current-item strong{display:block;overflow:hidden;color:#dbeafe;font:650 12px/1.35 ui-monospace,SFMono-Regular,monospace;text-overflow:ellipsis;white-space:nowrap}
    .progress-track{position:relative;height:9px;overflow:hidden;border:1px solid #ffffff0a;border-radius:999px;background:#020617}.progress-track i{position:relative;display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#0891b2,var(--cyan),var(--green));box-shadow:0 0 16px #22d3ee65;transition:width .45s cubic-bezier(.2,.8,.2,1)}.is-active .progress-track i::after{content:"";position:absolute;inset:0;width:45%;background:linear-gradient(90deg,transparent,#ffffffb5,transparent);transform:translateX(-130%);animation:ff-sheen 1.45s ease-in-out infinite}
    .activity-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:11px}.activity-grid>div{display:flex;align-items:center;justify-content:space-between;padding:8px 9px;border:1px solid #ffffff0b;border-radius:9px;background:#ffffff05}.activity-grid span{color:#7f8da3;font-size:10px;font-weight:750}.activity-grid strong{font:800 14px ui-monospace,SFMono-Regular,monospace}.activity-grid .ok strong{color:var(--green)}.activity-grid .bad strong{color:var(--red)}
    .message{margin-top:10px;padding:8px 10px;border-radius:8px;color:#bae6fd;background:#0c4a6e45;word-break:break-word}.actions{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.helper{margin:7px 0 0;color:#94a3b8}.collector-main{text-align:center}.collector-icon{display:grid;place-items:center;width:48px;height:48px;margin:2px auto 10px;border:1px solid #22d3ee55;border-radius:15px;color:var(--cyan);background:#22d3ee10;box-shadow:0 0 24px #22d3ee16;font-size:24px}.collector-main h2{margin:0;color:#f8fafc;font-size:18px}.collector-main .actions{display:block}.primary-start{width:100%;margin-top:2px;padding:11px 14px;background:linear-gradient(100deg,var(--cyan),var(--green));box-shadow:0 8px 24px #22d3ee20;font-size:13px}
    section.collapsed main{display:none}section.collapsed .ff-panel{border-color:#22d3ee55}section.collapsed header{border-bottom:0}.collapsed-status{display:inline-flex;align-items:center;justify-content:center}
    @keyframes ff-spin{to{transform:rotate(360deg)}}@keyframes ff-counter-spin{to{transform:rotate(-360deg)}}@keyframes ff-pulse{0%,100%{transform:scale(.9);opacity:.65}50%{transform:scale(1.16);opacity:1}}@keyframes ff-sheen{60%,100%{transform:translateX(340%)}}@keyframes ff-complete{0%{transform:scale(.97);opacity:.75}70%{transform:scale(1.012)}100%{transform:scale(1);opacity:1}}
    @media (prefers-reduced-motion: reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.01ms!important}}
  `;
}

function mountPanel(role) {
  const host = document.createElement('div');
  host.id = 'ffbypasser-host';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>${panelStyles()}</style><section></section>`;
  const section = shadow.querySelector('section');
  const handlers = new Map();
  let state = { job: null, message: '' };
  function render(job = state.job, message = state.message) {
    state = { job, message };
    section.innerHTML = renderPanelMarkup(panelViewModel(job, role, message));
    if (section.dataset.collapsed === 'true') {
      section.classList.add('collapsed');
      const collapseButton = section.querySelector('[data-action="collapse"]');
      if (collapseButton) collapseButton.textContent = '+';
    }
  }
  section.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'collapse') {
      const collapsed = section.dataset.collapsed !== 'true';
      section.dataset.collapsed = String(collapsed);
      section.classList.toggle('collapsed', collapsed);
      button.textContent = collapsed ? '+' : '-';
      return;
    }
    handlers.get(action)?.(event);
  });
  document.body.appendChild(host);
  render();
  return {
    render,
    on: (action, handler) => handlers.set(action, handler)
  };
}

function createBrowserGm() {
  return {
    getValue: (key, fallback) => GM_getValue(key, fallback),
    setValue: (key, value) => GM_setValue(key, value),
    deleteValue: key => GM_deleteValue(key),
    addValueChangeListener: (key, callback) => GM_addValueChangeListener(key, callback),
    openInTab: (url, options) => GM_openInTab(url, options),
    setClipboard: text => GM_setClipboard(text),
    download: options => GM_download(options)
  };
}

async function downloadResults(job, gm) {
  const text = formatSuccessfulResults(job);
  if (!text) throw new Error('No successful links to download');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  try {
    await gm.download({ url, name: 'Out_Direct_Links.txt', saveAs: true });
  } catch {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'Out_Direct_Links.txt';
    anchor.click();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function startCollector(panel, store, gm) {
  const links = normalizeFuckingFastLinks(Array.from(document.links, link => link.href), location.href);
  if (!links.length) {
    panel.render(null, 'No FuckingFast links were found on this page.');
    return;
  }
  const job = createJob(links, location.href);
  job.config.concurrency = CONFIG.concurrency;
  await store.saveJob(job);
  panel.render(job, `${links.length} unique links collected. Worker tab opened.`);
  gm.openInTab(links[0], { active: true, insert: true, setParent: true });
}

function bindCommonActions(panel, store, gm, role, startWorker) {
  panel.on('copy', async () => {
    const job = await store.loadJob();
    const text = formatSuccessfulResults(job);
    if (!text) return panel.render(job, 'No successful links to copy.');
    await gm.setClipboard(text);
    panel.render(job, 'Direct links copied.');
  });
  panel.on('download', async () => {
    const job = await store.loadJob();
    try {
      await downloadResults(job, gm);
      panel.render(job, 'TXT download started.');
    } catch (error) {
      panel.render(job, error.message);
    }
  });
  panel.on('retry', async () => {
    const job = retryFailed(await store.loadJob());
    await store.saveJob(job);
    panel.render(job, 'Failed links queued again.');
    const next = job.items.find(item => item.state === 'queued');
    if (role === 'collector' && next) gm.openInTab(next.link, { active: true, insert: true, setParent: true });
    if (role === 'worker') startWorker();
  });
  panel.on('clear', async () => {
    await store.clearAll();
    panel.render(null, 'Saved job cleared.');
  });
}

async function bootstrap() {
  const role = routeForHostname(location.hostname);
  if (!role || !document.body) return;
  const gm = createBrowserGm();
  const store = createStore(gm);
  const panel = mountPanel(role);
  let job = recoverJob(await store.loadJob());
  if (job) await store.saveJob(job);
  panel.render(job);
  store.watchJob(newJob => panel.render(newJob));

  if (role === 'collector') {
    panel.on('start', () => startCollector(panel, store, gm));
    bindCommonActions(panel, store, gm, role, () => {});
    return;
  }

  const owner = sessionStorage.getItem('ffbypasser.owner')
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sessionStorage.setItem('ffbypasser.owner', owner);
  let running = false;
  const startWorker = async () => {
    if (running) return;
    running = true;
    try {
      await runWorker(store, owner, nextJob => panel.render(nextJob));
      panel.render(await store.loadJob());
    } catch (error) {
      panel.render(await store.loadJob(), error.message);
    } finally {
      running = false;
    }
  };
  bindCommonActions(panel, store, gm, role, startWorker);
  if (job && summarizeJob(job).queued) startWorker();
}

const TEST_API = {
  CONFIG,
  normalizeFuckingFastLinks,
  fileIdOf,
  createJob,
  recoverJob,
  transitionItem,
  retryFailed,
  summarizeJob,
  createLease,
  canAcquireLease,
  buildRequestDescriptor,
  readRedirect,
  formatSuccessfulResults,
  createStore,
  runPool,
  routeForHostname,
  panelViewModel,
  renderPanelMarkup,
  frameStyleForVisibility,
  panelStyles
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = TEST_API;
} else {
  bootstrap().catch(error => console.error('[FFBypasser]', error));
}

