# DEV07 desktop main resource safety merge

State: `AUTHOR_SOURCE_ONLY_NO_BUILD_NO_TEST_NO_ELECTRON_NO_C19_WRITE`.
Scope: one author-tree file, `apps/desktop/src/main.ts`. The before snapshot is
the unchanged v4/author main SHA-256
`A1359F9EBC54090AD882C12B85E5CFB36917060D20D6B2DE245D9E364EA04C32`.
The read-only c19 safety source is SHA-256
`BDAB4361B5D0671735253C8A57258FC48005165F07969DCD9D56C3BDC5636DAC`.
The merged author main and `main.ts.after` are SHA-256
`51076243C1E39B544196D01EFDB76A1567138C255AAAC79D31131418ADD68D40`.
The single-file incremental `main.ts.patch` is SHA-256
`719D3FF2EC4D1C413CCF7B348D254A00D826DAC50A4D75693EC1C40D1103C517`.

## Exact source change

- Use `lstatSync` to require plain, non-symlink packaged resource entries.
  Require packaged Windows use and an absolute `process.resourcesPath` with
  no UNC prefix or `..` path component. Check the root directory, sidecar
  directory, config directory, media lock file, and sidecar executable.
- Check the renderer directory and `index.html` before loading it. On packaged
  startup, perform that renderer preflight after `app.whenReady()` and before
  `startSidecar`; retain the existing sidecar extraction TEMP/TMP path and
  startup failure classification.
- Preserve the v4 readiness, mutation, episode script, episode confirmation,
  and source acceptance IPC registrations. Each remains registered once with
  its existing client and top-frame guards. No preload or sidecar-process
  source was edited; their author SHA-256 values remain
  `77C06E152301829A2C46C3786BA6BA5F727AB189A2078D761C78993F16CD04F9`
  and `DE5D46DCE9CEB276F67A968F0B271B37498814CECECAF7AD7712FB6DBE22710F`.

## Static checks performed

The v4 stage still hashes to the before SHA; c19 still hashes to the source
SHA above. Before/after/patch SHA readback, `git apply --reverse --check`,
`git diff --check`, one registration per five named IPC handlers, and textual
renderer-preflight-before-sidecar ordering passed. These checks do not prove
TypeScript emit, Electron startup, native resource access, or packaged output.

## Exact independent QA gates (not run by DEV07)

1. From the reviewed overlay with this `main.ts` SHA, run
   `pnpm --filter @aijian/desktop typecheck` and
   `pnpm --filter @aijian/desktop test`.
   Record command, exit status, output, and all input source hashes. Resolve
   failures before emitting a native candidate.
2. In a controlled packaged Windows/Electron harness, reject relative,
   empty, UNC, and parent-component resource roots; reject a symlink root,
   sidecar directory, config directory, media lock, executable, renderer
   directory, or renderer index. Also reject a missing or wrong-type entry at
   each checked path. For renderer failures, assert `startSidecar` has not
   been called and no BrowserWindow loads a renderer. For sidecar resource
   failures, assert no sidecar child spawns. Record actual path, failure
   classification, and process counts without logging credentials.
3. With a valid packaged layout, assert renderer preflight precedes sidecar
   startup; read back the loaded `index.html`, EXE path, media lock path,
   `AIJIAN_RESOURCE_ROOT`, child TEMP/TMP, and normal close result. Match the
   installer manifest and exact emit/EXE hashes; a source snapshot alone is
   insufficient.
4. Exercise the five preserved IPC registrations through the packaged
   preload/renderer: readiness, metadata mutation, episode script, episode
   confirmation, and source acceptance. Assert one registration each,
   authorized top-frame behavior, and rejection of an unauthorized frame.
   Keep provider writes and real provider calls outside this resource gate.

This candidate is for MGR01 scope review, MGR02 independent QA, and MGR04
native overlay decision. The old signed v4 stage and c19 checkout were not
modified. No Electron, sidecar, test, build, or provider operation was run.
