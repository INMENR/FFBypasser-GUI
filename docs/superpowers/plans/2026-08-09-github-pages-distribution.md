# GitHub Pages Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish FFBypasser-GUI on `INMENR/FFBypasser-GUI` with one-click Violentmonkey installation and automatic updates.

**Architecture:** The repository root is the GitHub Pages source. `index.html` links to the colocated `FFBypasser.user.js`, whose metadata points back to the stable Pages script URL for version checks and downloads. Dependency-free Node tests verify the install link, metadata, language, and existing userscript behavior before the `main` push.

**Tech Stack:** Static HTML/CSS, Violentmonkey metadata, JavaScript ES2020, Node.js built-in test runner, GitHub Pages branch deployment, GitHub CLI.

## Global Constraints

- Push only to `INMENR/FFBypasser-GUI` `main`.
- Preserve the remote `Extractor.js` and `fitgirl-extractor.js` exactly.
- Use `https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js` for both update metadata URLs.
- Increment the userscript version from `1.0.0` to `1.0.1` for this published distribution change.
- Keep the install page dependency-free, responsive, analytics-free, and English-only.
- Run all tests and syntax checks before push.
- Enable GitHub Pages from `main` at `/` only after the verified commit is pushed.

---

## File Map

- Create `FFBypasser.user.js`: tested GUI userscript with distribution metadata.
- Create `index.html`: one-click installation landing page.
- Create `package.json`: dependency-free test command.
- Create `tests/core.test.js`: copied userscript domain regression tests.
- Create `tests/ui.test.js`: copied HUD and English-language regression tests.
- Create `tests/distribution.test.js`: install link and update metadata tests.
- Replace `Readme.md`: distribution, installation, use, updates, and development instructions.
- Preserve `Extractor.js` and `fitgirl-extractor.js`.

### Task 1: Distribution contract tests and userscript artifact

**Files:**
- Create: `package.json`
- Create: `tests/distribution.test.js`
- Create: `tests/core.test.js`
- Create: `tests/ui.test.js`
- Create: `FFBypasser.user.js`

**Interfaces:**
- Consumes: the tested source artifact from `C:/Users/user/Downloads/FFBypasser-main`.
- Produces: installable `FFBypasser.user.js` version `1.0.1` with stable update/download URLs.

- [ ] **Step 1: Add the test command and failing distribution test**

```json
{
  "name": "ffbypasser-gui",
  "private": true,
  "scripts": {
    "test": "node --test tests/*.test.js"
  }
}
```

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const scriptPath = path.join(root, 'FFBypasser.user.js');

test('userscript exposes stable Pages update metadata', () => {
  const source = fs.readFileSync(scriptPath, 'utf8');
  const url = 'https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js';
  assert.match(source, /^\/\/ @version\s+1\.0\.1$/m);
  assert.match(source, new RegExp(`^// @updateURL\\s+${url.replaceAll('.', '\\.')}$`, 'm'));
  assert.match(source, new RegExp(`^// @downloadURL\\s+${url.replaceAll('.', '\\.')}$`, 'm'));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/distribution.test.js`

Expected: FAIL because `FFBypasser.user.js` is not present in the fork clone.

- [ ] **Step 3: Add the tested artifact and regression tests**

Add the exact current contents of `FFBypasser.user.js`, `tests/core.test.js`, and `tests/ui.test.js` from the source folder. In the userscript metadata only, change `@version` to `1.0.1` and add:

```js
// @updateURL    https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js
// @downloadURL  https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js
```

- [ ] **Step 4: Run all tests and syntax validation**

Run:

```powershell
npm test
node --check FFBypasser.user.js
```

Expected: all source regression tests and the metadata test pass; syntax exits 0.

- [ ] **Step 5: Commit the artifact checkpoint**

```powershell
git add package.json FFBypasser.user.js tests
git commit -m "feat: add installable FFBypasser GUI userscript"
```

### Task 2: One-click installation page and README

**Files:**
- Create: `index.html`
- Modify: `tests/distribution.test.js`
- Modify: `Readme.md`

**Interfaces:**
- Consumes: root `FFBypasser.user.js` from Task 1.
- Produces: relative install link `./FFBypasser.user.js` and English deployment documentation.

- [ ] **Step 1: Write the failing install-page test**

```js
test('landing page links directly to the userscript', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  assert.match(html, /href="\.\/FFBypasser\.user\.js"/);
  assert.match(html, />Install with Violentmonkey</);
  assert.doesNotMatch(html, /[\uac00-\ud7a3]/);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test tests/distribution.test.js`

Expected: FAIL because `index.html` does not exist.

- [ ] **Step 3: Create the static install page**

Create semantic HTML with an English hero, a primary `Install with Violentmonkey` anchor to `./FFBypasser.user.js`, a prerequisite link to `https://violentmonkey.github.io/`, three concise usage steps, a GitHub repository link, inline responsive CSS, and no JavaScript or analytics.

- [ ] **Step 4: Replace the legacy README**

Document the Pages homepage, direct installation URL, Violentmonkey requirement, HUD workflow, challenge handling, automatic update behavior, version-bump rule, test command, and the two preserved legacy scripts.

- [ ] **Step 5: Run tests and language scan**

Run:

```powershell
npm test
$matches = @(Get-ChildItem -Recurse -File -Exclude '*.git*' | Where-Object { $_.FullName -notmatch '\\.git\\' } | Select-String -Pattern '[\uac00-\ud7a3]')
if ($matches.Count) { throw 'Korean text remains' }
```

Expected: all tests pass and the scan reports zero Korean matches.

- [ ] **Step 6: Commit the website checkpoint**

```powershell
git add index.html Readme.md tests/distribution.test.js
git commit -m "feat: add one-click installation page"
```

### Task 3: Push main, enable Pages, and verify production

**Files:**
- No new files.
- Verify: committed repository state and public URLs.

**Interfaces:**
- Consumes: verified commits from Tasks 1 and 2.
- Produces: public homepage and userscript URLs on GitHub Pages.

- [ ] **Step 1: Verify clean committed state and legacy integrity**

Run:

```powershell
git status --short
git diff dd9f05a -- Extractor.js fitgirl-extractor.js
npm test
node --check FFBypasser.user.js
```

Expected: clean status, empty legacy diff, all tests pass, syntax exits 0.

- [ ] **Step 2: Push the verified local main branch**

Run: `git push origin main`

Expected: `origin/main` advances to the local verified commit.

- [ ] **Step 3: Enable branch-based GitHub Pages**

Run:

```powershell
gh api --method POST repos/INMENR/FFBypasser-GUI/pages -f "source[branch]=main" -f "source[path]=/"
```

If Pages was concurrently enabled, update it instead with:

```powershell
gh api --method PUT repos/INMENR/FFBypasser-GUI/pages -f "source[branch]=main" -f "source[path]=/"
```

Expected: Pages reports the `main` branch and `/` source.

- [ ] **Step 4: Wait for bounded deployment completion**

Poll `gh api repos/INMENR/FFBypasser-GUI/pages/builds/latest` for up to five minutes, stopping when `status` is `built` or reporting the returned error when `status` is `errored`.

- [ ] **Step 5: Verify public endpoints and remote commit**

Run:

```powershell
gh api repos/INMENR/FFBypasser-GUI/commits/main --jq .sha
Invoke-WebRequest -UseBasicParsing 'https://inmenr.github.io/FFBypasser-GUI/'
Invoke-WebRequest -UseBasicParsing 'https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js'
```

Expected: remote SHA equals local `HEAD`; both URLs return HTTP 200; the userscript response contains version `1.0.1` and both update URLs.

## Completion Check

- Task 1 covers the tested userscript artifact, version, and automatic update metadata.
- Task 2 covers one-click installation, English documentation, and dependency-free presentation.
- Task 3 covers legacy preservation, direct `main` push, Pages configuration, deployment wait, and public verification.
