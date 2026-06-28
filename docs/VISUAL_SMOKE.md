# Visual Smoke Checks

Date: 2026-06-27

Run:

```powershell
npm.cmd run visual:smoke
```

## What The Gate Does

- Starts a temporary local Formspear server with an isolated JSON data file.
- Seeds a workspace, draft survey, published public slug, and realistic public survey fields.
- Launches a local Chromium-family browser through Chrome DevTools Protocol.
- Captures screenshots into `artifacts/visual-smoke/`.
- Writes `artifacts/visual-smoke/manifest.json`.
- Fails if a screenshot is unexpectedly small, the page logs a console error, the emulated viewport does not match, or horizontal overflow is detected.

## Routes Checked

Desktop app shell:

- Route: `/`
- Viewport: 1280 x 720
- Screenshot: `artifacts/visual-smoke/desktop-app-shell.png`
- Checks: no console errors, no horizontal overflow

Mobile public survey:

- Route: `/s/visual-smoke-survey`
- Viewport: 390 x 844 with mobile emulation
- Screenshot: `artifacts/visual-smoke/mobile-public-survey.png`
- Checks: no console errors, no horizontal overflow

## Latest Local Result

The latest local run passed with Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.

The manifest recorded:

- Desktop viewport `1280 x 720`, `scrollWidth: 1280`, `overflowX: false`, `consoleErrors: 0`
- Mobile viewport `390 x 844`, `scrollWidth: 390`, `overflowX: false`, `consoleErrors: 0`

`artifacts/` is intentionally ignored by Git because screenshots are generated verification output.
