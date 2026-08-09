# FFBypasser GUI

FFBypasser GUI is a Violentmonkey userscript that collects FuckingFast links from supported FitGirl pages, processes them in a persistent worker tab, and exports the resolved direct URLs.

# Developer

All source code was written by [cdxud](https://github.com/cdxud), to whom we extend our gratitude.
[Source Code](https://github.com/cdxud/FFBypasser)
and with my bestfriend Codex :)

## Install

1. Install the [Violentmonkey browser extension](https://violentmonkey.github.io/).
2. Open the [FFBypasser GUI installation page](https://inmenr.github.io/FFBypasser-GUI/).
3. Select **Install with Violentmonkey** and approve the script.

Direct userscript URL:

<https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js>

## Use

1. Open a supported FitGirl page containing FuckingFast download links.
2. Press **Extract Direct Links** in the floating panel.
3. Leave the FuckingFast worker tab open while the HUD processes the queue.
4. Complete a visible Cloudflare or CAPTCHA challenge if the host requests one.
5. After every link succeeds, the worker tab closes and returns you to FitGirl.
6. Use **Copy** or **Download TXT** in the completed FitGirl HUD.

The worker HUD displays progress only; result actions are never shown on FuckingFast. Failed items keep the worker tab open and can be queued again without losing successful results. Jobs survive supported-page reloads.

## Development

No external packages are required.

```powershell
npm test
node --check FFBypasser.user.js
```

The test suite covers link normalization, persistent job state, worker leasing, request descriptors, output ordering, HUD presentation, English-only copy, installation metadata, and the public install link.

## Legacy scripts

`Extractor.js` and `fitgirl-extractor.js` are preserved as references for the original browser-console workflow. New installations should use `FFBypasser.user.js`.
