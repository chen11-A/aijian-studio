# AIVORA desktop renderer

AIVORA is the only studio-web renderer. The web entry is `apps/studio-web/src/main.tsx`, which imports `./aivora/main`; Electron loads the resulting `apps/studio-web/dist/index.html` through `apps/desktop`.

## Current commands

Run these from the repository root with the existing workspace dependencies:

```powershell
pnpm --filter @aijian/studio-web typecheck
pnpm --filter @aijian/studio-web test
pnpm --filter @aijian/studio-web build
pnpm --filter @aijian/desktop build
pnpm --filter @aijian/desktop dev
```

The desktop development command builds the selected web renderer and desktop main process, then opens Electron. It uses the local sidecar boundary already defined by the desktop application. Do not use the removed demo Vite configuration, removed demo TypeScript configuration, or a second UI entry.

## Current scope

The renderer provides the accepted AIVORA navigation, editing, review, timeline, visual, media, settings, and service-management surfaces. Project/source, invalidation-history, timeline, and provider settings use the selected domain/controller and `StudioTransport` boundaries where those capabilities have been accepted. Provider connection management writes through the existing connection CRUD contract; it does not test a provider, discover models, send a generation request, or imply a paid account balance.

Some visual surfaces intentionally remain local presentation or sample state. They must not be read as evidence that an AI model, media reader, video/audio playback pipeline, task execution, external billing ledger, rendering, mixing, or export is connected. Unknown cost remains unknown. Media preview requires a separately approved read capability; no file path or arbitrary media bytes are read by this renderer.

The product has one current UI. Removed legacy `App`, ProductionShell, ProviderSettings, FakeWorkflow, InvalidationHistory, and Timeline visual roots are not alternative launch paths. Do not reintroduce legacy layout toggles or standalone demo entrypoints.

## Verification boundary

Run the current tests and type checks after a frozen change set. Test evidence demonstrates the exercised local behavior only. Runtime/device checks, external provider calls, generated media, charges, and export results require their own explicit accepted evidence.
