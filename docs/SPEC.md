# AIVORA v0.3.0 specification

The shipped window is professional only. There is no 普通模式 in the product.
Visible numbers, names, and pictures come from the open film or from a completed
job. A control that cannot run is disabled, or it explains the reason in one
short Chinese sentence.

## Stages

剧本 · 角色与场景 · 分镜 · 剪辑. 导出 is a button, not a fifth page.
分镜 opens 单镜工作台 for one shot: its still, its takes, and the generate action.
生成 is not its own page.

## Storage

A film is 剧 → 集 → 场 → 镜头 → 版本.
On the desktop, one series is a folder under the app data `films` directory.
The browser keeps each series in local storage and says it is not on disk.
Open, rename, and delete work on that store. A new episode copies the series,
the cast, and the style, then starts from an empty scene.

## Shot and prompt

景别, 角度, 运镜, 动作要点, and 表演 travel with the shot.
The style block is sent once. A prompt that already starts as a keyframe is not
wrapped again. 写实 is the default preset for a new film. It is not appended to
a different preset. `reference_images` are not sent. There is no shared cast still.

## Takes and queue

Every take is kept. 用这一版 sets the current version. The others stay.
The status bar shows the queue. Before a batch, the window says how many videos
will be made and about how many seconds they add up to, and that the count is
charged to the Grok membership. It does not invent a remaining balance.
The user confirms with 开始生成 or cancels with 先不生成.

## Picture and cut

A candidate still comes from image generation, or the window says why there is
no still. It is never a stock photo.
剪辑 plays the assembled MP4. If several shots cannot be joined, it plays the
selected take and says 多镜头还没接成一条，先播放这一镜。
Export asks for a folder, writes one file, then 打开文件夹 and 播放 work on that file.
撤销 and 重做 apply to the open film.

## Not in this phase

一键成片, the series-wide 角色/场景/道具 library, templates, and the beginner
助手 are Phase 2.
Timeline takes, full-quality 定稿, multi-format export, music and sound effects,
审片 badges, 设置, and 用量 are Phase 3. Those controls stay disabled with a
reason, or the menu says the page is not connected yet.
