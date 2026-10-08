# AIVORA desktop App UI candidate

This entry runs the product Electron main with the locally compiled R2 workbench. It does not start a browser server or backend sidecar. The native window opens at the project workspace, with compact scene/character layout and the shared modern timeline.

From this candidate checkout, invoke the existing Windows PowerShell executable directly:

    powershell.exe -NoProfile -File scripts/start-aivora-app-ui.ps1 -ArtifactRoot "C:\Users\Administrator\.codex\worktrees\e4app\sp\.aijian-dev\app-ui-e1-20260908T074346Z"

The argument must identify a built, hashed owned artifact directory in this checkout. The launcher validates the existing Electron binary and every build-manifest entry, then starts build/desktop/main.js with --aivora-app-ui. Missing tools or artifacts produce an error; it never downloads dependencies or builds. The delivery shortcut in the artifact evidence directory invokes this same launcher.

The standard native close/minimize/maximize controls remain. Closing the window normally ends the candidate runtime. Each launch writes separate logs and uses a fresh profile in the artifact directory, without a real user database. The optional -Inspect flag is for author/QA checks of this owned App only and opens an ephemeral loopback Chromium debugging endpoint; ordinary launch has no debugging endpoint.

The workbench uses sample React state. Project and episode selections, edits and timeline state are not real saved business data. Refresh/relaunch restores samples. AI services, generation, real media playback, export and fees remain unconnected. This is an App UI candidate, not complete product functionality, an installer, distribution approval or independent acceptance.

Product startup without --aivora-app-ui retains its previous backend path. This local candidate mode is rejected for packaged distribution. The original demo build config, frozen design resources, API, preload, security flags and contracts are preserved.
