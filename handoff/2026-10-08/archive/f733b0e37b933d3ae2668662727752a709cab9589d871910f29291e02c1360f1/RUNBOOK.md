# QA02 media preview native run envelope

Status: `STATIC_PREFLIGHT_ONLY_FRONT_WINDOW_AUTH_REQUIRED`.

`RUN-ENVELOPE.json` pins MGR04's two-file sync, QA03's Web typecheck/build,
MGR04's 25-file frozen renderer, desktop executable/dist/sidecar, and the r01
QA media package. `preflight.py` reads and hashes those inputs and checks that
the new isolated profile and evidence directory do not exist. It does not
launch Electron or mutate product data. Run it again immediately before any
approved native session; stop on the first changed input.

The Web build changed the renderer to `index-CyIvZNT0.js`; an older
`index-V0uKrLD3.js` cannot be used for this gate. The desktop dist was already
present and is pinned separately. `api-client.js` contains the complete-byte
SHA-256 comparison before `READY`; this is only static proof of the compiled
client branch.

The runtime action is deliberately not approved in this package. Actual
Electron launch uses a visible foreground window, real file picker, isolated
profile, and normal close. Obtain the user's foreground-window authorization
after reviewing the exact envelope and then make a separate one-shot run
approval. Do not change `APPROVAL-TEMPLATE.json` inside this frozen package;
the approval belongs outside it and must pin the package index, executable,
profile, evidence directory and allowed number of launches. No provider call.

After authorization, follow the ordered positive and negative cases in the
r01 `RUNTIME-QA-PLAN.md` and populate a fresh copy of its
`EVIDENCE-TEMPLATE.json` in the evidence directory. The first run may launch
once for import/preview and once to verify persistence after normal close.
If native dialog, locator, sidecar, playback, identity, or close fails,
preserve raw evidence and stop without automatically retrying. Record which
cases were actually observed; synthetic media and this build receipt do not
establish native playback.
