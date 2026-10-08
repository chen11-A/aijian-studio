# AIVORA project organization and delivery

Effective 2026-09-17. This charter records the approved separation of development, testing, production feedback, management review and delivery. It does not declare the application production-ready.

## Teams and responsibility

| Team | Manager | Members | Accountable output |
| --- | --- | --- | --- |
| Project management | Project controller | Four team managers | Priorities, cross-team dependencies, stage acceptance and user delivery |
| Software development | Software development manager | Frontend/interaction, backend/architecture, desktop/media engineers | Production features and assigned fixes; reviewed candidate commits |
| Testing and acceptance | Test manager | Independent QA engineer | Test cases, test code, build/type checks, functional/regression evidence and defect reports |
| Direction and video production | Production manager | Director/writer, character/environment artist, animation/Chinese lip-sync, editing/sound/review | Versioned production inputs, creative review and professional-user feedback |
| Version and release | Release manager | Version/delivery engineer | Approved commits, integration, remote refs, draft PRs, packaging and rollback records |

The backend engineer also owns product Skill/Agent execution and provider/model integration contracts. Frontend owns visible controls and recoverable states. Desktop/media owns runtime, playback and encoding integration. Managers coordinate and review; they do not substitute their own declarations for independent acceptance.

## Work and defect flow

Each approved task names its owner, manager, baseline commit, allowed scope, dependencies, user-visible behavior and handoff conditions. One implementation owner per package; no concurrent writes to the same files.

Developers implement production code and hand off a frozen commit. They do not write or execute tests. The testing team owns test design, test code and execution, including type/build checks and necessary native acceptance. Existing tests and failure evidence remain protected.

Flow: manager assigns -> developer implements -> software manager reviews -> testing team executes -> test manager reviews defects -> software manager appoints one fixer -> QA retests the exact repair commit -> managers sign their respective conclusions -> controller accepts the stage -> release team integrates/delivers.

Other developers continue independent features during a local defect repair. A manager pauses affected work only for a shared blocker such as data loss, security risk or an unusable common baseline. Test defects belong to QA; creative changes belong to production. No repeated full-suite loop without a changed input or justified unresolved risk.

## Professional-user feedback

Production members also evaluate the software on a fixed build and an original sample scenario. They assess intent preservation, character/asset consistency, dialogue/lip-sync controls, timeline/subtitle editing, saved revisions, limited regeneration and usability. They record the input/output versions, steps, obstacle, expected behavior and observable evidence.

The production manager classifies feedback as functional defect, usability improvement, AI capability gap or creative preference. QA converts objective issues into acceptance cases; the software manager schedules implementation. Product skills/agents are changed only through versioned tasks with a fixed skill/agent/model and input examples. Reviews do not authorize editing developer tools, global Codex skills, credentials, paid services or uploading media.

## Manager acceptance and progress

- Software manager: requirement coverage, scope, implementation and interface compatibility; concludes ready-for-test or returned.
- Test manager: exact commit/environment, reproducible cases, evidence and defects; signs technical test status.
- Production manager: content versions, creative judgment and actual usability; distinguishes specifications from produced media.
- Release manager: accepted source version, package contents, remote/artifact identity and rollback; distinguishes WIP preservation from release.
- Controller: reconciles all conclusions on the same integrated version, checks the end-to-end stage outcome and delivers for user acceptance.

Report approved features as planned, implementing, ready-for-test, testing, returned, technically accepted, user-reviewed, integrated or delivered. Test counts, chat counts and documents do not represent product completion percentages.

## Goal mode and model policy

Goals are finite handoff packages: developers deliver code; QA delivers results/defects; production delivers the specified content/review; managers deliver a signed package decision; the controller delivers a stage. Missing dependencies do not authorize unlimited retries or unapproved scope. A completed package stops and awaits the next assignment.

Goal mode and recurring monitoring are not enabled by writing this charter. Periodic monitoring requires a configured scheduler and should notify only on meaningful changes or blockers. Pauses remain effective.

All newly created project roles use GPT-5.6 Luna with medium reasoning, as requested. Existing controller settings are retained. Product text/image/video/TTS/lip-sync providers are separate configuration with explicit capability, version, permissions and cost records; staffing models do not establish production-media capability.

## Current delivery boundary

The selected desktop UI and substantial backend code exist, but the end-to-end production workflow, independent installation and final media delivery remain incomplete. The preserved product checkpoint is WIP. Project creation follow-up is tracked in [Issue #3](https://github.com/chen11-A/aijian-studio/issues/3); its first repair candidate remains unaccepted. The original 38-second sample package is a specification, not a finished video.
