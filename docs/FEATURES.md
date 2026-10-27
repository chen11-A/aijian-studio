# AIVORA v0.3.0 features

P0 is the professional desktop. Fixture screens are for tests. The product path
opens the professional workspace and cannot switch to a beginner mode.

## Phase 1, in this build

- Four stages: 剧本, 角色与场景, 分镜, 剪辑. Export is a button.
- 单镜工作台 lives inside 分镜. It shows the real takes for the selected shot.
- Series and episodes are stored per project. Desktop uses a folder. The browser
  says the copy is not on disk.
- Shot fields and one style block go into the image prompt and the video prompt
  once. Unproven `reference_images` are omitted.
- The queue shows real progress. A batch waits for 开始生成 after the estimate.
- 剪辑 plays the joined file, or one take with the reason it could not join.
- Export writes the file the user picked. 打开文件夹 and 播放 use that path.
- Undo and redo cover the open film.
- Image model `grok-imagine-image-2.0` (retires 2026-11-02), video
  `grok-imagine-video-1.5`, draft `grok-imagine-video-1.5-lite`. Empty model
  lists disable generate and say why.
- Edit and extend stay off unless the catalog contains `grok-imagine-video`.
- 分割, zoom, snap, search, and the 设置 and 用量 pages say they are not connected.
  分割 does not cut. 删除 removes the shot.

## Phase 2, not in this build

一键成片 stops at 分镜 before video generation. 角色与场景 becomes a series-wide
library of 角色, 场景, and 道具. Templates and one beginner 助手 land here.

## Phase 3, not in this build

Takes on the timeline, 定稿, gap close, the pre-export check, 16:9 / 9:16 /
subtitle export, snapshots, bundled music and effects, 声音自动调好, 统一色调,
and 审片 markers. The loudness sentence in the product note stays until then.

## Honesty

No paid call in tests. A missing login, a missing model, or an unproven endpoint
is a Chinese reason, not a fake still, a fake clock, or a fake path.
