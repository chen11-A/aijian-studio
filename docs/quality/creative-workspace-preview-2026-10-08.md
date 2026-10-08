# Archived native creative-workspace preview

The user chose to retain the original UI after viewing this preview on
2026-10-08. Its normal-delivery entry and shell integration have been removed;
the isolated prototype source is retained only as an abandoned comparison.
The saved project data and original-layout corrections remain in place.
The launch instructions below describe the historical preview, not a current
product option. Do not re-enable it without a new user request.

This prototype is in the local `repair/runtime-baseline` working tree. It is an
opt-in layout for the real script and storyboard editors, not a replacement for
the existing default UI and not a browser deliverable.

## Start and compare

Use the repository's existing native development launch (`pnpm dev:desktop`).
The existing managed Python sidecar and desktop prerequisites still apply.
Open a real project and episode. From the project, script or storyboard page,
open the user menu and choose **试用桌面工作区**. The **剧本 / 分镜** document
navigation uses the same guarded routes as the default shell. Choose
**返回原布局** to leave. Restarting defaults to the original layout.

Do not start a second native process against an already-open workspace.
Coordinate the launcher with whoever currently owns the desktop session.

## Layout and data boundary

- Fixed project/episode navigator with the current scene or shot outline.
- One editable document controller at a time. The central script/storyboard
  editor begins immediately below compact tabs and its editing toolbar.
- Contextual right-hand properties; optional AI service and task information.
- Pointer-capture and keyboard-arrow splitters, with column bounds that reserve
  document space at the supported 980×680 minimum window.
- Save and latest status remain in the fixed bottom bar; notices remain visible
  independently of document scrolling.
- Script persistence, version confirmation, stable scene/block IDs, pending-write
  journals and navigation guards remain in `EpisodeScriptEditor` and its existing
  adapters. `ScriptSceneBlocks` and JSX presentation slots are shared by both
  layouts. The storyboard view uses the existing `useEpisodeStoryboard` hook
  and version/reference adapters.
- No new package dependencies, backend schema, provider call, sample content or
  media replacement is introduced by the layout. Accepted-source summary import
  is a separate integration that supplies an optional empty-document control.

## Checks

Passed against the integrated source tree:

- Studio TypeScript typecheck.
- Focused ESLint and Prettier checks for the new workspace files.
- Nine focused component checks across `CreativeWorkspaceEditors.test.tsx` and
  `EpisodeStoryboardPanel.test.tsx`: script save/readback, unchanged IDs,
  cancellation of dirty navigation, episode isolation, storyboard create/save,
  reopening, references and recovery behavior. These use controlled transport
  doubles and do not by themselves establish native IPC acceptance.

The broader `C19ProductionInteractions.test.tsx` run returned 51 passed and
15 failed, across assets/story/source/assembly cases outside this presentation
slice. It must not be represented as a full clean suite.

Native window, screenshot, persisted UI editing and unsaved-navigation acceptance
are coordinated by the native implementation/audit owner. Their result must be
recorded before treating the preview as visually accepted.
