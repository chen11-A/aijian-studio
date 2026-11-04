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
- Export writes the file the user picked, keeping Chinese in the file name.
  打开文件夹 and 播放 use that path. A clip longer than the chosen seconds is trimmed.
- 生成画面 and 生成定妆照 call image generation. 导演拆镜头 calls the signed-in text model.
- The cast page fills characters and places from the script. The queue chip
  clears when a take finishes. 剪辑 plays with the app's own controls.
- Undo and redo cover the open film.
- A shot can store a length up to 15 seconds. Each shot keeps an empty sound
  plan, and the film keeps an empty list of clips for the later lanes 对白,
  环境音, 音效, and 配乐. Phase 1 does not fill them, does not call speech,
  and still asks the video to stay silent.
- Image model `grok-imagine-image-2.0` (retires 2026-11-02), video
  `grok-imagine-video-1.5`, draft `grok-imagine-video-1.5-lite`. Empty model
  lists disable generate and say why.
- Edit and extend stay off unless the catalog contains `grok-imagine-video`.
- 分割, zoom, snap, search, and the 设置 and 用量 pages say they are not connected.
  分割 does not cut. 删除 removes the shot.

## Phase 2, not in this build

一键成片 stops at 分镜 before video generation. 角色与场景 becomes a series-wide
library of 角色, 场景, and 道具. Templates and one beginner 助手 land here.
Sound probes, a character voice with 试听, scene 环境音, the shot sound block,
and shot length taken from the line are also Phase 2. They are not in this build.

## Phase 3, not in this build

Takes on the timeline, 定稿, gap close, the pre-export check, 16:9 / 9:16 /
subtitle export, snapshots, bundled music and effects, 声音自动调好, 统一色调,
and 审片 markers. The four audio lanes, ducking, and loudness export are Phase 3.
The visible note says the loudness will match across phones and computers.
It does not name LUFS. The numeric target stays internal until then. The timeline in this
build still shows 字幕, 视频, 配音, and 音乐.

## Honesty

No paid call in tests. A missing login, a missing model, or an unproven endpoint
is a Chinese reason, not a fake still, a fake clock, or a fake path.
