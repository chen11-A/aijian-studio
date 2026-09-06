# AIVORA UI Demo implementation note

This branch is intentionally limited to a non-production UI demonstration based on the current AIVORA Desktop Creator product baseline and approved visual direction.

## Scope
- Five visible stages: 故事 → 角色与世界 → 分镜 → 制作 → 审片.
- Simple Mode first; Professional Mode is represented only as a view toggle shell.
- World-building page follows the simplified composition: large 16:9 world visual, four world tags, short summary, one primary action, one revision entry, and a weak “详细设定” link.
- Left project navigation is intentionally compact: 故事, 角色与世界(角色/世界观/场景), 分镜, 制作, 审片, 素材, 导出, AI 服务, 设置.
- Aivora AI is one assistant surface; no multi-agent chat UI.
- All data is local demo data. No Provider, persistence, billing, generation, rights, release, or production workflow behavior is implemented.

## Non-goals
- This branch must not be treated as implementation of GenerationContract, Agent/Skill runtime, Provider integration, real timeline, review execution, release, or production data models.
- Demo states must be visibly demo/mock; do not fabricate production readiness.
