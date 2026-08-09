

// paste the urls u got here
const links = []
//add verboseFirst and showFrames to true if facing issues or  also if getting rate limited try to add concurrency to 2
const CONFIG = {
    concurrency: 5,
    delayMs: 800,
    pageTimeoutMs: 30000,
    tokenWaitMs: 12000,
    captureTimeoutMs: 20000,
    showFrames: false,
    verboseFirst: false,
};


const sleep = ms => new Promise(r => setTimeout(r, ms));
const green = "color: #00ff00";
const red = "color: #ff5555";
const blue = "color: #38bdf8";
const grey = "color: #888";

function fileIdOf(link) {
    return new URL(link, location.origin).pathname.split('/').filter(Boolean).pop();
}

function absolutize(u, origin) {
    try { return new URL(u, origin).href; } catch { return u; }
}

function readRedirect(headers) {
    return headers.get('hx-redirect') || headers.get('HX-Redirect')
        || headers.get('hx-location') || headers.get('location');
}


let hostPanel = null;

function ensurePanel() {
    if (hostPanel) return hostPanel;
    hostPanel = document.createElement('div');
    hostPanel.style.cssText = [
        'position:fixed', 'right:8px', 'bottom:8px', 'z-index:2147483647',
        'display:flex', 'gap:6px', 'flex-wrap:wrap',
        'max-width:70vw', 'padding:6px', 'border-radius:8px',
        'background:rgba(0,0,0,.8)', 'box-shadow:0 0 0 1px #333',
        CONFIG.showFrames ? 'opacity:1' : 'opacity:0;pointer-events:none',
    ].join(';');
    document.body.appendChild(hostPanel);
    return hostPanel;
}

function loadFrame(src) {
    return new Promise((resolve, reject) => {
        const frame = document.createElement('iframe');
        frame.style.cssText = 'width:300px;height:200px;border:0;background:#111';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            frame.remove();
            reject(new Error('page load timeout'));
        }, CONFIG.pageTimeoutMs);

        frame.onload = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(frame);
        };
        frame.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            frame.remove();
            reject(new Error('frame load error'));
        };
        frame.src = src;
        ensurePanel().appendChild(frame);
    });
}

function frameWindow(frame) {
    try {
        const win = frame.contentWindow;
        if (!win || !win.document || !win.document.body) return null;
        void win.location.href;
        return win;
    } catch {
        return null;
    }
}

let popup = null;
let popupBlocked = false;

function ensurePopup() {
    if (popup && !popup.closed) return popup;
    popup = window.open('about:blank', 'ffx_extractor', 'width=520,height=420');
    if (!popup) popupBlocked = true;
    return popup;
}

async function loadInPopup(src) {
    const win = ensurePopup();
    if (!win) throw new Error('popup blocked - allow popups for this site');
    win.location.href = src;
    const deadline = Date.now() + CONFIG.pageTimeoutMs;
    while (Date.now() < deadline) {
        await sleep(150);
        try {
            if (win.closed) throw new Error('popup closed');
            if (win.document.readyState === 'complete'
                && win.location.href.split('#')[0] === src.split('#')[0]) {
                return win;
            }
        } catch (e) {
            if (String(e.message).includes('closed')) throw e;
            // transient cross-origin during navigation; keep polling
        }
    }
    throw new Error('page load timeout (popup)');
}

/* ------------------------------------------------- page inspection helpers */

function neuterAds(win) {
    try { win.open = () => null; } catch {}
    try {
        win.addEventListener('beforeunload', e => { e.stopImmediatePropagation(); }, true);
    } catch {}
}

function grabToken(win) {
    const doc = win.document;
    const input = doc.querySelector(
        'input[name="cf-turnstile-response"], input[name="g-recaptcha-response"], input[name="h-captcha-response"]'
    );
    if (input && input.value) return { name: input.name, value: input.value };
    try {
        if (win.turnstile && typeof win.turnstile.getResponse === 'function') {
            const v = win.turnstile.getResponse();
            if (v) return { name: 'cf-turnstile-response', value: v };
        }
    } catch {}
    return null;
}

function tokenWidgetPresent(win) {
    const doc = win.document;
    return !!doc.querySelector(
        '.cf-turnstile, [data-sitekey], iframe[src*="challenges.cloudflare.com"], input[name="cf-turnstile-response"]'
    );
}

// Waits for a Cloudflare token only if the page actually shows a widget.
async function waitForToken(win) {
    if (!tokenWidgetPresent(win)) return null;
    const deadline = Date.now() + CONFIG.tokenWaitMs;
    while (Date.now() < deadline) {
        const tok = grabToken(win);
        if (tok) return tok;
        await sleep(250);
    }
    return grabToken(win);
}

function findTrigger(win, id) {
    const doc = win.document;
    const hx = doc.querySelector(`[hx-post*="/${id}/"], [hx-post], [data-hx-post]`);
    if (hx) return hx;
    const byText = Array.from(doc.querySelectorAll('a,button'))
        .find(el => /download/i.test(el.textContent || ''));
    return byText || null;
}

function describeRequest(win, id) {
    const trigger = findTrigger(win, id);
    const path = (trigger && (trigger.getAttribute('hx-post') || trigger.getAttribute('data-hx-post')))
        || `/f/${id}/go`;

    const params = new URLSearchParams();

    const valsAttr = trigger && (trigger.getAttribute('hx-vals') || trigger.getAttribute('data-hx-vals'));
    if (valsAttr) {
        try {
            const vals = JSON.parse(valsAttr);
            for (const [k, v] of Object.entries(vals)) params.set(k, String(v));
        } catch {}
    }

    const form = (trigger && trigger.closest('form')) || win.document.querySelector('form');
    if (form) {
        for (const [k, v] of new FormData(form).entries()) {
            if (typeof v === 'string') params.set(k, v);
        }
    }

    const headers = {
        'HX-Request': 'true',
        'HX-Current-URL': win.location.href,
        'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (trigger) {
        const target = trigger.getAttribute('hx-target') || trigger.getAttribute('data-hx-target');
        if (target) headers['HX-Target'] = target.replace(/^#/, '');
        if (trigger.id) headers['HX-Trigger'] = trigger.id;
        const nameAttr = trigger.getAttribute('name');
        if (nameAttr) headers['HX-Trigger-Name'] = nameAttr;
    }

    return { path, params, headers, trigger };
}


async function strategyFast(id) {
    const res = await fetch(`/f/${id}/go`, {
        method: 'POST',
        credentials: 'include',
        headers: {
            'HX-Request': 'true',
            'HX-Current-URL': location.href,
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: '',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = readRedirect(res.headers);
    if (!url) throw new Error('no hx-redirect header');
    return absolutize(url, location.origin);
}

async function strategyFrameFetch(win, id, verbose) {
    const req = describeRequest(win, id);
    const token = await waitForToken(win);
    if (token) req.params.set(token.name, token.value);

    if (verbose) {
        console.log('%c   ↳ endpoint:', grey, req.path);
        console.log('%c   ↳ body keys:', grey, Array.from(req.params.keys()));
        console.log('%c   ↳ token:', grey, token ? `${token.name} (${token.value.length} chars)` : 'none found');
    }

    const res = await win.fetch(req.path, {
        method: 'POST',
        credentials: 'include',
        headers: req.headers,
        body: req.params.toString(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const url = readRedirect(res.headers);
    if (url) return absolutize(url, win.location.origin);

    const text = await res.text();
    const match = text.match(/https?:\/\/[^\s"'<>\\]+/);
    if (match) return match[0];
    throw new Error('no redirect in headers or body');
}

function armCapture(win) {
    let resolveFn;
    const captured = new Promise(res => { resolveFn = res; });

    try {
        const proto = win.XMLHttpRequest.prototype;
        const origOpen = proto.open;
        proto.open = function (...args) {
            this.addEventListener('readystatechange', () => {
                if (this.readyState !== 4) return;
                try {
                    const url = this.getResponseHeader('hx-redirect')
                        || this.getResponseHeader('hx-location');
                    if (url) resolveFn(url);
                } catch {}
            });
            return origOpen.apply(this, args);
        };
    } catch {}

    try {
        const origFetch = win.fetch;
        win.fetch = function (...args) {
            return origFetch.apply(this, args).then(res => {
                try {
                    const url = readRedirect(res.headers);
                    if (url) resolveFn(url);
                } catch {}
                return res;
            });
        };
    } catch {}

    return captured;
}

async function strategyClick(win, id) {
    neuterAds(win);
    const captured = armCapture(win);
    await waitForToken(win);

    const trigger = findTrigger(win, id);
    if (!trigger) throw new Error('download trigger not found on page');

    trigger.click();
    await sleep(700);
    trigger.click();

    const url = await Promise.race([
        captured,
        sleep(CONFIG.captureTimeoutMs).then(() => null),
    ]);
    if (!url) throw new Error('no request captured after click');
    return absolutize(url, win.location.origin);
}


let useFrames = true;
let fastPathWorks = true;

async function resolveLink(link, index, total) {
    const id = fileIdOf(link);
    const label = `[${index + 1}/${total}]`;
    const verbose = CONFIG.verboseFirst && index === 0;
    const errors = [];

    if (fastPathWorks) {
        try {
            const url = await strategyFast(id);
            console.log(`%c${label} ✅ ${url}`, green);
            return url;
        } catch (e) {
            errors.push(`fast: ${e.message}`);
            if (index === 0) {
                fastPathWorks = false;
                console.log(`%c   fast path unavailable (${e.message}) - switching to page-context mode`, blue);
            }
        }
    }

    let host = null;
    let win = null;
    try {
        if (useFrames) {
            host = await loadFrame(link);
            win = frameWindow(host);
            if (!win) {
                host.remove();
                host = null;
                useFrames = false;
                console.log('%c   framing blocked (X-Frame-Options) - switching to popup mode', blue);
            }
        }
        if (!win) {
            win = await loadInPopup(link);
        }

        neuterAds(win);

        try {
            const url = await strategyFrameFetch(win, id, verbose);
            console.log(`%c${label} ✅ ${url}`, green);
            return url;
        } catch (e) {
            errors.push(`frame: ${e.message}`);
        }

        try {
            const url = await strategyClick(win, id);
            console.log(`%c${label} ✅ ${url} %c(via click)`, green, grey);
            return url;
        } catch (e) {
            errors.push(`click: ${e.message}`);
        }
    } catch (e) {
        errors.push(`load: ${e.message}`);
    } finally {
        if (host) host.remove();
    }

    console.log(`%c${label} ❌ ${link}\n     ${errors.join(' | ')}`, red);
    return null;
}


async function runPool(items, worker, size) {
    const out = new Array(items.length);
    let cursor = 0;
    const lanes = Array.from({ length: Math.max(1, size) }, async () => {
        while (true) {
            const i = cursor++;
            if (i >= items.length) break;
            out[i] = await worker(items[i], i, items.length);
            await sleep(CONFIG.delayMs);
        }
    });
    await Promise.all(lanes);
    return out;
}

async function extractAll() {
    console.log('%c🚀 FuckingFast Direct Link Extractor v2 (Cloudflare-aware)',
        'color:#00ff00;font-size:16px;font-weight:bold');

    if (!location.hostname.includes('fuckingfast')) {
        console.log('%c⚠ Run this from a FuckingFast file page, not from here.', red);
        return;
    }
    if (!links.length) {
        console.log('%c⚠ The `links` array is empty. Paste your links into it first.', red);
        return;
    }

    console.log(`%c${links.length} links queued, concurrency ${CONFIG.concurrency}`, blue);

    const started = performance.now();
    const results = (await runPool(links, resolveLink, CONFIG.concurrency)).filter(Boolean);
    const secs = ((performance.now() - started) / 1000).toFixed(1);

    if (hostPanel) hostPanel.remove();
    if (popup && !popup.closed) popup.close();

    console.log(`%c\n🎉 Done: ${results.length}/${links.length} in ${secs}s\n`,
        'color:#00ff00;font-size:14px;font-weight:bold');

    if (!results.length) {
        console.log('%cNothing resolved. Do this once manually and tell me what you see:', red);
        console.log('%c  1. Click DOWNLOAD by hand.  2. Network tab.  3. Find POST /f/<id>/go.', grey);
        console.log('%c  4. Right-click it -> Copy as fetch.  That shows the exact missing piece.', grey);
        return [];
    }

    const text = results.join('\n');
    console.log(text);

    try { copy(text); console.log('%c(copied to clipboard)', grey); } catch {}

    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'Out_Direct_Links.txt';
    a.click();
    URL.revokeObjectURL(url);

    return results;
}

extractAll();
