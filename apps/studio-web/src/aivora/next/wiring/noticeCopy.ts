import type { UiNotice } from "../../film/contracts3j";

/**
 * Final wording for the notice codes GPT sends (C7, 3J-U04). GPT's NOTICE_TEXT in
 * film/notices.ts is only the fallback; the status bar shows the line from here.
 *
 * Kept in step with docs/design/copy-zh.md「后端给的提示」. noticeCopy.test.ts fails when
 * GPT adds a code that has no line here yet.
 */
export const NOTICE_COPY: Readonly<Record<string, string>> = {
  ASSISTANT_REFERENCE_UNKNOWN: "引用没有对上当前作品和场次，请从 @ 菜单重新选择。",
  ASSISTANT_REFERENCE_AMBIGUOUS: "引用有重名或重复镜号，请先核对，暂未发送。",
  ASSISTANT_REFERENCE_SYNTAX: "引用写法还没完整，请从 @ 菜单重新选择。",
  ASSISTANT_REFERENCE_STALE: "引用内容或当前范围已变化，请重新检查后再发送。",

  HISTORY_SAVED: "当前版本已保存到历史。",
  HISTORY_READ_FAILED: "历史版本暂时无法读取，请重试。",
  HISTORY_RESTORED: "已恢复历史版本，恢复前的作品已另存。",
  HISTORY_RESTORE_FAILED: "历史恢复尚未确认，请核对当前作品。",
  HISTORY_BACKUP_FAILED: "历史快照没有保存，请先重试。",
  HISTORY_STALE: "作品内容已变化，请重新选择历史版本。",

  EXPORT_QC_RUNNING: "正在准备并检查成片。",
  EXPORT_QC_READY: "技术检查完成，请审阅后再发布。",
  EXPORT_QC_FAILED: "导出前检查没有完成，请查看原因后重试。",
  EXPORT_QC_STALE: "工程、版本或导出设置已变化，请重新检查。",
  EXPORT_QC_BLOCKED: "检查发现要先处理的问题，暂不能发布。",
  ASSEMBLY_PARTIAL: "粗剪已有文件，声音或字幕处理还没完成。",
  ASSEMBLY_SOURCE_CLOCK_MISMATCH: "所选原视频与不带字幕版本的实际时长不同，请先核对。",
  ASSEMBLY_SHOT_REQUIRED: "请先选择当前正在播放的镜头，再标记范围。",
  ASSEMBLY_CLOCK_REQUIRED: "粗剪时钟尚未核验，请重新合成后再按镜头跳转或标记范围。",
  PROMPTER_SUGGESTION_READY: "画面说明已准备好，确认后才修改。",
  PROMPTER_FIELDS_APPLIED: "画面说明已修改。",
  PERFORMANCE_SUGGESTION_READY: "表演建议已准备好，确认后才修改。",
  PERFORMANCE_FIELDS_APPLIED: "表演字段已修改。",
  ACTION_SUGGESTION_READY: "动作建议已准备好，确认后才修改。",
  ACTION_FIELDS_APPLIED: "动作字段已修改。",
  ART_SUGGESTION_READY: "全项目美术建议已准备好，确认后才修改。",
  ART_FIELDS_APPLIED: "全项目美术字段已修改。",
  DIRECTOR_STRUCTURE_READY: "本场导演结构建议已准备好，确认后才修改。",
  DIRECTOR_STRUCTURE_APPLIED: "本场导演镜头结构已修改。",
  CREATION_UNCONFIGURED: "请先设置创作链失败上限，再新增生成。",
  CREATION_INPUT_UNVERIFIABLE: "这一步的创作输入无法核验，未提交本次请求。",
  CREATION_INPUT_FAILURE_LIMIT: "同一创作链失败或未决已达上限，未提交这一步。",
  CREATION_ATTEMPT_ALREADY_RESERVED: "这次创作链已有提交记录，请先核对原任务。",
  VIDEO_FAILURE_UNCONFIGURED: "请先设置同输入视频失败上限，尚未发起新的生成。",
  VIDEO_FAILURE_ACCOUNT_UNVERIFIABLE: "当前登录身份无法核验，尚未发起新的生成。",
  VIDEO_FAILURE_INPUT_UNVERIFIABLE: "视频输入的实际内容无法核验，没有提交视频。",
  VIDEO_FAILURE_INPUT_FAILURE_LIMIT: "同输入的视频失败或未决次数已达设置上限，没有提交视频。",
  VIDEO_FAILURE_ATTEMPT_ALREADY_RESERVED: "这次视频提交已有记录，未重复提交；请先核对原任务。",
  WRITER_STRUCTURE_READY: "全项目编剧结构建议已准备好，确认后才修改。",
  WRITER_STRUCTURE_APPLIED: "全项目编剧场次结构已修改。",
  GENERATION_EXECUTION_ACCOUNT_UNAVAILABLE: "当前登录身份无法核验，请重新登录后再准备生成。",
  GENERATION_EXECUTION_SOURCE_UNVERIFIABLE: "当前素材或视频输入无法核验，请核对素材后再试。",
  GENERATION_EXECUTION_SCOPE_UNSUPPORTED: "这一批暂不支持受保护的自动生成，请重新核对所选范围。",
  GENERATION_EXECUTION_BUSY: "当前作品仍在准备生成，请等处理结束后再试。",
  WRITE_UNCONFIRMED: "写入结果尚未确认，请先核对。",
  MEDIA_SCOPE_UPPER_BOUND: "请确认完整镜头范围，前置图和视频将使用会员额度。",
  GENERATION_EXECUTION_UNAVAILABLE: "当前桌面版本还不支持受保护的自动生成，请更新后再试。",
  GENERATION_EXECUTION_WRITE_UNCONFIRMED: "生成记录尚未确认，已停后续请求，请先核对任务和素材。",
  GENERATION_EXECUTION_UNCONFIRMED: "自动生成尚未确认，已停止后续请求；请先核对当前任务和素材。",
  GENERATION_SELECTION_STALE: "所选镜头已经变化，请重新选择后生成。",
  GENERATION_ALREADY_RUNNING: "这一批还在生成，请等完成后再试。",
  CLEAN_COPY_NOT_REQUIRED: "没有需要补做的镜头。",
  CLEAN_COPY_PROGRESS: "正在补做不带字幕的版本。",
  CLEAN_COPY_INTERRUPTED: "补做中断，已经保存的版本会保留。请查看剩余镜头后重试。",
  CLEAN_COPY_DONE: "不带字幕的版本补好了。",
  CLEAN_COPY_FAILED: "不带字幕的版本没有补好，可以重试。",
  CLEAN_COPY_SOURCE_MISSING: "找不到原来的合成记录，暂时不能补做。",
  CLEAN_COPY_STALE: "作品或版本已经变化，已跳过旧结果。",
  CLEAN_COPY_PARTIAL: "部分镜头已补好，请查看剩余镜头后重试。",
  CAPTURE_ENABLED_REQUIRED: "先开启保存原始回复，再进行导演或动作生成。",
  CAPTURE_REPLY_MISSING: "这个作品还没有匹配的导演原始回复。开启保存后再进行生成。",
  CAPTURE_EXPORT_DONE: "排查文件已下载到本机。",
  CAPTURE_EXPORT_FAILED: "排查文件没有导出，请重试。",
  LOCATION_SOURCE_REQUIRED: "这一场还没有可用的环境描述。",
  MULTI_VOICE_PROVIDER_REQUIRED: "分角色配音需要 Grok 会员。",
  DIALOGUE_VIDEO_LIMIT: "对白放不下，请拆成两个镜头。",
  VIDEO_TOO_SHORT: "画面太短，请生成更长的画面。",
  DIALOGUE_VIDEO_REQUIRED: "视频未完成，已保留配音，请重试。",
  NOTICE_CLEAR: "",
  WORK_INTERRUPTED: "上次关软件时还有镜头没做完，已经停下了。可以重新生成。",
  WRITING_PROGRESS: "AI 正在写…",
  DIRECTOR_PROGRESS: "导演正在拆镜头…",
  PERFORMANCE_PROGRESS: "表演指导正在写表演…",
  STALL_RETRYING: "导演一分钟没回话，正在自动重试",
  TEXT_TIMEOUT: "AI 太久没回话，已经停下了。可以再试一次。",
  TEXT_STALLED: "AI 写到一半停住了。可以再试一次。",
  TASK_TIMEOUT: "这件事等得太久，已经停下了。",
  REQUEST_STALE: "等的时候你改了内容，这次的结果没有用上。",
  WORK_STALE: "已经换了作品，刚才那件事停下了。",
  BATCH_RESPONSE_INVALID: "AI 这次的回答不完整，没有用上。可以再试一次。",
  WRITER_FAILED: "编剧这次没写完，可以再试一次。",
  DIRECTOR_FAILED: "导演这次没拆完，可以再试一次。",
  ONECLICKFILM_FAILED: "一键成片停在了半路，可以再试一次。",
  PLANACTION_FAILED: "动作指导这次没写完，可以再试一次。",
  PLANART_FAILED: "美术这次没写完，可以再试一次。",
  PLANPERFORMANCE_FAILED: "表演指导这次没写完，可以再试一次。",
  PLANPROMPTER_FAILED: "画面说明这次没写完，可以再试一次。",
  PLANQC_FAILED: "审片这次没看完，可以再试一次。",
  COVERAGE_INCOMPLETE: "有的场还有内容没拍到，去分镜看看。",
  COVERAGE_COMPLETE: "这一场的台词和结尾都有镜头了。",
  COVERAGE_REPAIRING: "正在补上结尾…",
  DIRECTOR_OVER_BUDGET: "镜头比建议的多，内容都留着，可以在分镜里合并。",
  ACTION_UNASSIGNED: "有动作没对上镜头，去分镜看看。",
  VOICE_EMPTY: "这一镜没有台词，不用配音。",
  VOICE_TRAITS_REQUIRED: "先在角色页选好性别和年龄，再配音。",
  MULTI_VOICE_REQUIRED: "这一镜有几个人说话，要分开配音。",
  VOICE_PROGRESS: "正在配音…",
  VOICE_FAILED: "配音没做成，可以再试一次。",
  VOICE_DONE: "配音好了。",
  VOICE_PREVIEW_PROGRESS: "正在试听…",
  VOICE_PREVIEW_STOPPED: "已停止试听。",
  VOICE_PREVIEW_UNAVAILABLE: "现在试听不了。",
  SOUND_DISABLED: "预览是静音的。按 M 或点预览上的喇叭打开声音。",
  // 4B-U03: the workspace's own code for 「用这个样式」 on 剪辑 → 字幕.
  SUBTITLE_STYLE_SAVED: "已记下字幕样式。",
  // 4B-U04: 「用这个封面」 in the export dialog.
  COVER_SAVED: "已记下封面。",
  DIALOGUE_REQUIRED: "先给这一镜写一句台词。",
  DURATION_LOCKED: "这一镜的时长是你定的，没有改。",
  DURATION_SPLIT_REQUIRED: "这句台词太长，建议拆成两个镜头。",
  DURATION_UPDATED: "镜头时长改好了。",
  DURATION_ESTIMATED: "时长先按台词字数估算。",
  GROK_MEMBERSHIP_REQUIRED: "这一步要先用 Grok 会员登录。",
  DESKTOP_REQUIRED: "网页版做不了这一步，请在电脑上装好的 AIVORA 里继续。",
  AUTH_BROWSER_OPENING: "正在打开浏览器，在那一页点允许就行。",
  AUTH_CONNECTED: "已登录 Grok 会员。",
  ENTITLEMENT_DENIED: "这个会员用不了生成。",
  AUTH_CANCELLED: "登录已取消。",
  AUTH_FAILED: "登录没有完成，可以再试一次。",
  AUTH_SIGNED_OUT: "已退出登录。",
  AUTH_SIGNOUT_FAILED: "退出没有完成，可以再试一次。",
  REAUTH_REQUIRED: "登录过期了，请重新登录 Grok 会员。",
  MODEL_UNAVAILABLE: "Grok 现在用不了这项功能。",
  DRAFT_MODEL_UNAVAILABLE: "快速试做现在用不了。",
  SCRIPT_APPLIED: "已放进剧本。",
  SHOTS_APPLIED: "已放进分镜。",
  SHOT_APPLIED: "这一镜已放进分镜。",
  ART_APPLIED: "画风和人物外貌已放进去。",
  ALREADY_APPLIED: "这一步已经放进去了。",
  USER_EDIT_PRESERVED: "你改过的地方都留着。",
  SCENES_REQUIRED: "还没有能放进剧本的场。",
  SHOTS_REQUIRED: "先拆好镜头。",
  CAST_NOT_FOUND: "还没认出人物和场景。",
  CAST_RECORDED: "人物已记下。",
  APPEARANCE_PROGRESS: "正在从剧本里找人物外貌…",
  APPEARANCE_REQUIRED: "先写下外貌，再出定妆照。",
  PORTRAIT_PROGRESS: "正在出定妆照…",
  PORTRAIT_FAILED: "定妆照没出成，可以再试一次。",
  PORTRAIT_DONE: "定妆照出好了。",
  PORTRAIT_BATCH_RUNNING: "正在给所有人出定妆照…",
  PORTRAIT_BATCH_PARTIAL: "有几张定妆照没出成，可以单独重试。",
  PORTRAIT_BATCH_DONE: "所有人的定妆照都出好了。",
  IMPORT_FAILED: "文件没读进来。",
  IMPORT_EMPTY: "这个文件里没有能用的正文。",
  IMPORT_FORMAT_UNSUPPORTED: "请导入 txt、docx 或 epub 文件。",
  IMPORT_TRUNCATED: "文件太长，请分几次导入。",
  IMPORT_READY: "场次读好了，确认后放进剧本。",
  TEMPLATE_APPLIED: "故事模板已放进剧本。",
  STORYBOARD_PROGRESS: "正在写剧本和分镜…",
  STORYBOARD_READY: "分镜好了。看一遍，点「继续出视频」才会生成视频。",
  STILL_PROGRESS: "正在出画面…",
  FIRST_FRAME_PROGRESS: "正在照着定妆照出开头画面…",
  FIRST_FRAME_FAILED: "开头画面没出成，可以再试一次。",
  STILL_REJECTED: "这张画面未获准生成，请调整画面描述后重试。",
  STILL_CAST_LIMIT: "这一镜人物太多，请拆成更少人物的镜头后重试。",
  STILL_FAILED: "画面没出成，可以再试一次。",
  STILL_DONE: "画面出好了。",
  STILL_CANDIDATES_READY: "开头画面出好了，选一张。",
  STILL_CONFIRM_REQUIRED: "确认后才出这几张开头画面。",
  COMPOSITION_SELECTED: "已换成这张画面。",
  GENERATION_CONFIRM_REQUIRED: "看一下要生成的镜头和版本数，确认后才开始。",
  GENERATION_QUEUED: "已排上队。",
  GENERATION_PAUSED: "已暂停。已经发给 Grok 的那几个可能还会做完。",
  GENERATION_CANCELLED: "已取消还没开始的镜头。",
  GENERATION_CANCEL_REQUESTED: "已取消。如果已经发给 Grok，它可能还会做完。",
  GENERATION_FAILED: "这段视频没做成，可以再试一次。",
  GENERATION_DONE: "这一版做好了。",
  GENERATION_NO_FAILURES: "没有失败的，不用重试。",
  ASSEMBLY_FAILED: "镜头没接成一整片，可以再试一次。",
  EXPORT_INCOMPLETE: "还有镜头没有视频，导出前看一下范围。",
  EXPORT_FOLDER_REQUIRED: "先选一个保存的文件夹。",
  EXPORT_PROGRESS: "正在导出…",
  EXPORT_FAILED: "导出没有完成，可以再试一次。",
  EXPORT_DONE: "成片已导出。",
  PROJECT_CREATED: "新作品建好了。",
  PROJECT_RENAMED: "作品名改好了。",
  PROJECT_OPEN_FAILED: "这部作品没打开，可以再试一次。",
  PROJECT_OPENED: "作品已打开。",
  PROJECT_DELETED: "作品已删除。",
  EPISODE_CREATED: "新一集建好了。",
  EPISODE_DELETED: "这一集已删除。",
  EXAMPLE_OPENED: "示例已打开。",
  SHOT_SELECTED: "已选中这一镜。",
  SHOT_REMOVED: "已剪掉这一段，前后接上了。",
  REVIEW_RECORDED: "审片意见已记下，挑哪一版还是由你定。",
  REVIEW_TEXT_ONLY: "审片还不会看画面，只能给文字意见。",
  AUDIO_MUTED: "这一轨已静音。",
  AUDIO_VOLUME_SAVED: "音量已记下。",
  AUDIO_MUSIC_IMPORTED: "音乐已导入。",
  TAKE_PREVIOUS_KEPT: "留着原来那一版。",
  TAKE_REPLACED: "已换成新的一版。",
  TAKE_UNAVAILABLE: "还没有新的一版可以换。",
  OPERATION_CANCELLED: "已取消。",
  // 4a codes from gpt/work-4a (docs/aivora/4a-notice-handoff.md), in that list's order.
  BILLING_PROJECT_REQUIRED: "生成前的准备没做完，可以再试一次。",
  SHOT_STILL_INPUT_CHANGED: "这一镜在出图时改过，那张图没有放进去。",
  STILL_CANDIDATE_PRESERVED: "新画面放进了候选，你选的开头画面没变。",
  ART_APPLIED_UNSAVED: "美术的建议已经放进去，还没保存上。",
  PROMPTER_APPLIED_UNSAVED: "画面说明已经放进去，还没保存上。",
  REVIEW_REASON_REQUIRED: "写一句你看过画面的结论，才能继续。",
  REVIEW_INPUT_STALE: "审的时候画面变了，请再看一遍。",
  REVIEW_INVALID: "审片结果不完整，请再看一遍。",
  REVIEW_SHOT_UNKNOWN_OR_DUPLICATE: "审片说的是哪个镜头不清楚，请核对一下。",
  REVIEW_TAKE_UNKNOWN_OR_DUPLICATE: "审片说的是哪一版不清楚，请核对一下。",
  REVIEW_RECOMMENDATION_UNVERIFIED: "推荐的那一版还没人确认，请自己看一眼。",
  PIPELINE_REQUEST_STALE: "做的时候内容改过，这次的结果没有放进去。",
  VOICE_PROJECT_REQUIRED: "配音前的准备没做完，可以再试一次。",
  VOICE_METADATA_TIMEOUT: "读配音时长太久，可以再试一次。",
  VOICE_AUDIO_FAILED: "这段配音放不出来，请检查一下声音文件。",
  BILLING_PROJECT_STALE: "已经换了作品，配音准备停下了。",
  BILLING_PROJECT_ID_INVALID: "配音准备没成功，可以再试一次。",
  STATE_INVALID: "一键成片的进度读不出来了，看一下已经做好的，再重新开始。",
  RUN_INTERRUPTED: "上次一键成片没做完就停了，先看看哪些已经做好。",
  REQUEST_CANCELLED: "已取消。",
  PIPELINE_ALREADY_RUNNING: "一键成片已经在做了，不用再点。",
  PIPELINE_INPUT_CHANGED: "剧本或角色改过了，看一下再重新开始。",
  CHECKPOINT_INVALID: "分镜检查的信息不全，请再核对一遍。",
  PIPELINE_TARGETS_CHANGED: "要做的镜头变了，请再核对一遍。",
  PIPELINE_TARGETS_INVALID: "要做的镜头不完整，请检查分镜。",
  HUMAN_REVIEW_ACCEPTED: "已记下你看过画面的确认。",
  REQUEST_OUTCOME_UNKNOWN: "不确定上次那一下做成没有，先核对再重试，免得多用一次额度。",
  PIPELINE_INPUT_INVALID: "作品内容读不出来，请检查一下作品。",
  VIDEO_SUBMISSIONS_ESTIMATE: "要生成几段视频是估的，开始前再看一眼。",
  PROJECT_REQUIRED: "先打开一部作品。",
  PIPELINE_PREPARATION_INVALID: "画面和声音的准备对不上，已经停下了。",
  PIPELINE_PREPARATION_REQUIRED: "先把画面和声音存好，再继续。",
  STEP_RESULT_MISSING: "这一步没拿到结果，可以再试一次。",
  STEP_RESULT_STALE: "这一步的结果已经过时，没有放进去。",
  PROJECT_RESULT_MISMATCH: "这个结果不是这部作品的，没有放进去。",
  PIPELINE_SAVE_FAILED: "一键成片的进度没存上，先核对再重试。",
  PORTRAIT_CAPABILITY_REQUIRED: "现在出不了定妆照，请检查登录和网络。",
  LOCATION_IMAGE_INCOMPLETE: "场景图还没出全，请补上。",
  PORTRAITS_INCOMPLETE: "定妆照还没出全，请补上。",
  MEDIA_CAPABILITY_REQUIRED: "现在出不了画面和视频，请检查登录和网络。",
  MEDIA_RESULT_MISSING: "没拿到生成的画面或视频，请看一下后台生成。",
  STILL_NOT_ACCEPTED: "画面还没核对，请先采用这一镜再出视频。",
  VIDEO_COVERAGE_INCOMPLETE: "有的镜头还没有视频，请补上。",
  VIDEO_FILE_MISSING: "找不到视频文件，请检查保存的地方。",
  ASSEMBLY_CAPABILITY_REQUIRED: "网页版接不了成片，请在电脑上装好的 AIVORA 里继续。",
  ASSEMBLY_RESULT_MISSING: "没拿到成片文件，可以再接一次。",
  STEP_UNSUPPORTED: "这一步现在还做不了。",
  PERFORMANCE_READY: "表演建议好了，确认后放进分镜。",
  PERFORMANCE_OFFLINE: "没登录，先用软件自己的规则写了表演，请看一下。",
  PERFORMANCE_UNASSIGNED: "有的表演没对上镜头或人物，请看一下。",
  PERFORMANCE_VOICE_REVIEW: "这句台词是谁说的不清楚，请确认说话人。",
  SPEAKER_UNSPECIFIED: "先确认这一镜是谁在说话。",
  MULTIPLE_SPEAKERS: "这一镜有几个人说话，请分别确认语气。",
  VOICE_NOT_UNIQUE: "这个人的语气有几种说法，请选一个。",
  UNKNOWN_PERFORMER: "表演里有人物还没认出来，请核对。",
  PERFORMANCE_TARGETS_INCOMPLETE: "有的镜头还没有表演建议，请补上。",
  PERFORMANCE_PARSE_FAILED: "表演指导这次的回答读不懂，可以再试一次。",
  PERFORMANCE_NOT_REQUIRED: "这一场不用再补表演。",
  EDITOR_UNDO_CONFLICT: "后来又改过，这次修改撤销不了。",
  EDITOR_EDIT_CONFLICT: "后来又改过，留着现在的内容。",
  PIPELINE_RECOVERY_FAILED: "一键成片的进度没能接上，可以再试一次。",
  VISUAL_REVIEW_REQUIRED: "请自己看一遍画面，确认后再继续。",
  ACTION_NOT_REQUIRED: "这一场不用再补动作。",
  ACTION_PARSE_FAILED: "动作指导这次的回答读不懂，可以再试一次。",
  ART_PARSE_FAILED: "美术这次的回答读不懂，可以再试一次。",
  CAST_PARSE_FAILED: "这次没认出人物，可以再试一次。",
  DIRECTOR_PARSE_FAILED: "导演这次的回答读不懂，可以再试一次。",
  PROMPTER_PARSE_FAILED: "画面说明这次读不懂，可以再试一次。",
  WRITER_PARSE_FAILED: "编剧这次的回答读不懂，可以再试一次。",
  SCENE_NOT_FOUND: "这一场已经变了，请重新选一下。",
  SHOT_NOT_FOUND: "这个镜头已经变了，请重新选一下。",
  SOURCE_REQUIRED: "先写下故事。",
  SCRIPT_COVERAGE_REVIEW: "有的原文还没分到场里，请看一下场次。",
  STEP_COMPLETE: "这一步做好了。",
  TEXT_CANCELLED: "已取消这次提问。",
  TEXT_REJECTED: "Grok 没有接受这次的内容，改一改再试。",
  USER_FIELDS_PRESERVED: "你改过的地方都留着。",
  PROJECT_MISMATCH: "已经换了作品，请重新操作。",
  SELECTION_MISMATCH: "选的内容变了，请重新要一次建议。",
  NOTHING_TO_UNDO: "这一页没有可以撤销的修改。",
  NO_CHANGES: "没有要改的地方。",
  SUGGESTION_MISSING: "这条建议已经失效，请重新要一次。",
  BUSY: "正在保存，请稍等。",
  SAVE_DEFERRED: "修改还没存上，稍后再试。",
  SAVE_FAILED: "修改没存上，可以再试一次。",
  LOCK_METADATA_CHANGED: "这条建议想改你锁定的内容，没有放进去。",
  TARGET_EDITED: "这里后来改过，请重新要一次建议。",
  STRUCTURE_STALE: "镜头已经调整过，请重新要一次建议。",
  SELECTION_REQUIRED: "先选要改的场或镜头。",
  DEPENDENT_WORK_EXISTS: "这些镜头已经出过画面或视频，改之前请先看一下。",
  DEPENDENCIES_CHANGED: "相关的内容变了，请再核对一遍。",
  DUPLICATE_OR_EMPTY_ID: "有的镜头对不上号，没有放进去。",
  INVALID_CONTINUITY_REFERENCE: "「接上一镜」指的镜头不对，请检查前后两个镜头。",
  INVALID_SCOPE_IDS: "选的范围不对，请重新选。",
  INVALID_TARGET_ORDER: "镜头顺序不对，没有放进去。",
  MEDIA_REPLACEMENT_UNSUPPORTED: "这条建议不能换掉已经做好的画面或视频。",
  NEW_SHOT_HAS_ASSETS_OR_DEPENDENCIES: "新加的镜头带着旧的画面或关联，没有放进去。",
  NONCONTIGUOUS_SCOPE: "请选挨在一起的镜头。",
  OTHER_COLLECTION_CHANGED: "这条建议改到了别的地方，没有放进去。",
  OUTSIDE_SCOPE_EDIT: "这条建议改到了选中范围以外，没有放进去。",
  OUTSIDE_SCOPE_STRUCTURE: "这条建议动了选中范围以外的镜头，没有放进去。",
  PAGE_SCOPE_MISMATCH: "这条建议不是这一页的，没有放进去。",
  // Old service results (INTEGRATION.md 第一部分). The reason stays in detail.
  FILM_SUCCEEDED: "试做版已经保存，可以在播放器里打开看看。",
  FILM_BLOCKED: "这一片被拦下了，没有生成。",
  FILM_FAILED: "这一片没做成，可以再试一次。",
};

/**
 * Codes that only say "look at the sentence": the caller's own sentence is the message. Their
 * fallback text is generic, so showing it would hide what actually happened.
 */
const OWN_SENTENCE = new Set(["OPERATION_STATUS", "EDITOR_GUIDANCE"]);

/** One line for the status bar, plus what the tooltip and the task-center log show. */
export type StatusLine = { code: string; text: string; detail: string };

const joined = (notice: UiNotice) => [notice.text, notice.detail].filter(Boolean).join(" ");

/** Program data (JSON) in a detail is for the log file, never for the person using the app. */
function readable(detail: string): string {
  return detail
    .split("\n")
    .filter((line) => {
      if (!/^\s*[[{]/.test(line)) return true;
      try {
        JSON.parse(line);
        return false;
      } catch {
        return true;
      }
    })
    .join("\n")
    .trim();
}

/**
 * The status-bar line for what the workspace shows now.
 *
 * `shown` is the sentence the workspace put in the status bar. `last` is the latest
 * aivora-notice event. When the workspace was handed a code, `shown` is the event's text and
 * detail joined, and the line comes from NOTICE_COPY. When it was handed a plain sentence, that
 * sentence is shown as it is: guessing a code from wording is only a compatibility aid, and
 * the sentence usually carries names and counts the code does not.
 */
export function statusLine(shown: string, last: UiNotice | null): StatusLine | null {
  const plain = shown.trim();
  if (!plain) return null;
  if (last && joined(last) === plain) {
    const detail = readable(last.detail?.trim() ?? "");
    if (OWN_SENTENCE.has(last.code)) {
      const [first = last.text, ...rest] = detail ? detail.split("\n") : [last.text];
      return { code: last.code, text: first, detail: rest.join("\n") };
    }
    const copy = NOTICE_COPY[last.code];
    return { code: last.code, text: copy || last.text, detail };
  }
  return { code: last?.code ?? "OPERATION_STATUS", text: plain, detail: "" };
}

/** Whether an aivora-notice event is the one behind the sentence the workspace shows. */
export function noticeMatches(last: UiNotice, shown: string): boolean {
  const plain = shown.trim();
  return Boolean(plain) && (joined(last) === plain || last.detail === plain || last.text === plain);
}
