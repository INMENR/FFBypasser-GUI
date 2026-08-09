# FitGirl Result Handoff Design

## Goal

Move all result actions out of the FuckingFast worker HUD. When every queued link succeeds, close the worker tab and return the user to the original FitGirl page, where the completed HUD provides the result actions.

## User Flow

1. The user starts extraction from a supported FitGirl page.
2. FFBypasser opens one FuckingFast worker tab and processes the saved queue.
3. The FuckingFast HUD shows progress and status only. It never shows `Copy`, `Download TXT`, or `Clear`.
4. If every item succeeds, the worker tab shows a brief completion state and closes automatically.
5. The original FitGirl tab receives the completed job through the existing shared-storage listener and shows a prominent `Ready to download` state with `Copy`, `Download TXT`, and `Clear`.
6. The user downloads the TXT file from the FitGirl page.

## Partial Failure Behavior

If one or more items fail, the FuckingFast tab stays open. Its HUD displays the failure count, error details, and `Retry failed`, but no result or clear actions. This keeps the recovery controls beside the worker while preventing downloads from the unreliable page context.

## Architecture

- Keep the existing shared job record and value-change listener.
- Make result-action rendering role-aware: collector-only for `Copy`, `Download TXT`, and `Clear`.
- Keep `Retry failed` available in the worker role when failures exist.
- Add a small, independently testable worker-completion decision that closes only an all-success job.
- Use the worker tab's normal `window.close()` path because it was created by `GM_openInTab`.
- Let browser tab focus naturally return to the originating FitGirl tab; do not open another FitGirl tab.

## Error Handling

- Never close the worker for partial failures, queued work, or processing work.
- If the browser refuses `window.close()`, leave the completed worker HUD visible with guidance to return to the FitGirl tab.
- Keep error messages and retry behavior intact.

## Testing

- Verify worker markup omits `Copy`, `Download TXT`, and `Clear` for both success and failure states.
- Verify collector completion markup includes the result actions and ready-to-download guidance.
- Verify the auto-close decision is true only when all items succeeded.
- Run the complete Node test suite and syntax check before release.

## Release

Bump the userscript and landing-page version, publish to `main`, then verify the public GitHub Pages script contains the new version and handoff behavior.
