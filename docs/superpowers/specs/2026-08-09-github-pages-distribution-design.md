# GitHub Pages Distribution Design

## Goal

Publish FFBypasser-GUI from `INMENR/FFBypasser-GUI` so a person can open one public page, click one install button, approve the Violentmonkey prompt, and receive future script updates automatically.

## Repository Changes

- Add the tested `FFBypasser.user.js` from the local development folder.
- Add a lightweight `index.html` installation page at the repository root.
- Replace the legacy README with English installation, usage, update, and development instructions for the GUI userscript.
- Add a dependency-free `package.json` and the existing automated tests.
- Preserve `Extractor.js` and `fitgirl-extractor.js` as legacy references.

## Installation and Update URLs

The stable public userscript URL is:

`https://inmenr.github.io/FFBypasser-GUI/FFBypasser.user.js`

The metadata block uses that exact HTTPS URL for both:

- `@updateURL`: version-check source
- `@downloadURL`: updated script download source

The existing `@version` remains the comparison key. Every published behavior change must increment it before pushing.

## Installation Page

`index.html` contains:

- Product name and a short description
- One prominent `Install with Violentmonkey` link to `./FFBypasser.user.js`
- A short prerequisite note linking to Violentmonkey
- A concise three-step usage summary
- A link to the GitHub repository

The page is static, responsive, dependency-free, and contains no analytics or external JavaScript.

## GitHub Pages

GitHub Pages is enabled for the `main` branch and repository root. Deployment uses GitHub's branch-based Pages source rather than a custom workflow.

## Verification

- Run the complete Node test suite.
- Validate userscript JavaScript syntax.
- Confirm the metadata contains the exact update and download URLs.
- Confirm the install page link resolves to `FFBypasser.user.js`.
- Confirm the two legacy scripts retain their remote versions.
- Commit the distribution files to `main`, push to `origin/main`, enable Pages, and verify the public page and userscript return successful HTTP responses.

## Acceptance Criteria

- Opening the Pages homepage shows a clear installation action.
- Clicking the action opens the `.user.js` URL that Violentmonkey can intercept.
- The installed userscript knows where to check and download later versions.
- Tests and syntax validation pass before push.
- The final commit is present on `INMENR/FFBypasser-GUI` `main`.
