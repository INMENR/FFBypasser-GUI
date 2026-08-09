# FitGirl Result Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove result actions from FuckingFast, close an all-success worker tab, and offer TXT download only from the originating FitGirl page.

**Architecture:** Keep the existing shared job and storage listener. Make panel actions role-aware, add a pure all-success close predicate, and invoke an injected close callback only after the worker finishes successfully.

**Tech Stack:** Violentmonkey userscript JavaScript, Node.js built-in test runner, static GitHub Pages distribution.

## Global Constraints

- FuckingFast never shows `Copy`, `Download TXT`, or `Clear`.
- Partial failures keep the FuckingFast tab open with error and retry controls.
- Only an all-success completed job closes the worker tab.
- FitGirl retains `Copy`, `Download TXT`, and `Clear` after completion.
- No external packages.

---

### Task 1: Role-aware result actions

**Files:**
- Modify: `FFBypasser.user.js`
- Test: `tests/ui.test.js`

**Interfaces:**
- Consumes: `renderPanelMarkup(panelViewModel(job, role, message))`
- Produces: collector-only result actions and worker-only retry recovery

- [ ] **Step 1: Write failing UI tests**

Replace the successful worker assertion with explicit absence checks and add collector completion guidance:

```js
test('successful worker view hides all result actions', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  const html = api.renderPanelMarkup(api.panelViewModel(job, 'worker'));
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
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/ui.test.js`

Expected: worker absence test and collector guidance test fail against the existing shared action row.

- [ ] **Step 3: Implement role-aware markup**

In `renderPanelMarkup`, gate result and clear actions by collector role:

```js
if (role === 'collector' && job && summary.succeeded) {
  actions.push('<button data-action="copy">Copy</button>');
  actions.push('<button data-action="download">Download TXT</button>');
}
if (job && summary.failed) actions.push('<button data-action="retry">Retry failed</button>');
if (role === 'collector' && job) actions.push('<button class="muted" data-action="clear">Clear</button>');
```

Set the collector's completed current-item label to `Ready to download` while leaving the worker completion label as `All items processed`.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/ui.test.js`

Expected: all UI tests pass.

- [ ] **Step 5: Commit**

```powershell
git add FFBypasser.user.js tests/ui.test.js
git commit -m "feat: move result actions to FitGirl"
```

---

### Task 2: Close only successful worker tabs

**Files:**
- Modify: `FFBypasser.user.js`
- Test: `tests/core.test.js`

**Interfaces:**
- Produces: `shouldCloseWorker(job): boolean` and `handoffCompletedWorker(job, panel, environment): boolean`
- Consumes: completed job returned from shared storage after `runWorker`

- [ ] **Step 1: Write the failing close-decision test**

```js
test('worker closes only after every item succeeds', () => {
  let success = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  success = api.transitionItem(success, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  let partial = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  partial = api.transitionItem(partial, 0, { state: 'failed', error: 'HTTP 500' });
  assert.equal(api.shouldCloseWorker(success), true);
  assert.equal(api.shouldCloseWorker(partial), false);
  assert.equal(api.shouldCloseWorker(null), false);
});

test('successful worker handoff renders guidance before closing', () => {
  let job = api.createJob(['https://fuckingfast.co/f/a'], 'x', 1);
  job = api.transitionItem(job, 0, { state: 'succeeded', directUrl: 'https://cdn/a' });
  let message = '';
  let closed = false;
  const panel = { render: (_job, nextMessage) => { message = nextMessage; } };
  const handled = api.handoffCompletedWorker(job, panel, {
    closeTab: () => { closed = true; },
    schedule: callback => callback()
  });
  assert.equal(handled, true);
  assert.equal(message, 'Returning to FitGirl...');
  assert.equal(closed, true);
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/core.test.js`

Expected: FAIL because `shouldCloseWorker` is not exported.

- [ ] **Step 3: Implement the pure predicate and close handoff**

```js
function shouldCloseWorker(job) {
  const summary = summarizeJob(job);
  return summary.done && summary.succeeded === summary.total && summary.failed === 0;
}

function handoffCompletedWorker(job, panel, environment = {}) {
  if (!shouldCloseWorker(job)) return false;
  const closeTab = environment.closeTab || (() => window.close());
  const schedule = environment.schedule || setTimeout;
  panel.render(job, 'Returning to FitGirl...');
  schedule(closeTab, 700);
  return true;
}
```

After `runWorker`, replace the existing render call with:

```js
const latest = await store.loadJob();
panel.render(latest);
handoffCompletedWorker(latest, panel);
```

If closing is refused, the worker remains visible and no result actions appear.

- [ ] **Step 4: Verify GREEN and syntax**

Run: `node --test tests/core.test.js`

Expected: all core tests pass.

Run: `node --check FFBypasser.user.js`

Expected: exit code 0 with no output.

- [ ] **Step 5: Commit**

```powershell
git add FFBypasser.user.js tests/core.test.js
git commit -m "feat: close successful worker tabs"
```

---

### Task 3: Release and documentation

**Files:**
- Modify: `FFBypasser.user.js`
- Modify: `index.html`
- Modify: `README.md`
- Test: `tests/distribution.test.js`

**Interfaces:**
- Produces: public userscript release `1.0.4`

- [ ] **Step 1: Set the failing distribution expectation**

Change the metadata assertion to:

```js
assert.match(source, /^\/\/ @version\s+1\.0\.4$/m);
```

- [ ] **Step 2: Verify RED**

Run: `node --test tests/distribution.test.js`

Expected: FAIL because the script is still `1.0.3`.

- [ ] **Step 3: Update release files**

Set `// @version 1.0.4`, change the landing-page badge to `v1.0.4`, and update README usage so it says the successful worker closes automatically and downloads are performed from the FitGirl HUD.

- [ ] **Step 4: Run complete verification**

Run: `npm test`

Expected: 0 failed tests.

Run: `node --check FFBypasser.user.js`

Expected: exit code 0.

Run: `git diff --check`

Expected: exit code 0.

- [ ] **Step 5: Commit and publish**

```powershell
git add FFBypasser.user.js index.html README.md tests/distribution.test.js
git commit -m "release: publish FFBypasser 1.0.4"
git push origin main
```

- [ ] **Step 6: Verify GitHub Pages**

Fetch `https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js` with a cache-busting query and confirm it contains `@version 1.0.4`, `shouldCloseWorker`, and collector-only result-action guards.
