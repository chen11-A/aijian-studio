import type { UiNotice } from "../../film/contracts3j";

/**
 * Final wording for the notice codes GPT sends (C7, 3J-U04). GPT's NOTICE_TEXT in
 * film/notices.ts is only the fallback; the status bar shows the line from here.
 *
 * Kept in step with docs/design/copy-zh.md「后端给的提示」. noticeCopy.test.ts fails when
 * GPT adds a code that has no line here yet.
 */
export const NOTICE_COPY: Readonly<Record<string, string>> = {
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
  SOUND_DISABLED: "预览是静音的，打开顶栏的声音再听。",
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
  COMPOSITION_SELECTED: "已换成这张构图。",
  GENERATION_CONFIRM_REQUIRED: "看一下要生成的镜头和版本数，确认后才开始。",
  GENERATION_QUEUED: "已排上队。",
  GENERATION_PAUSED: "已暂停。已经发出去的几段可能还会做完。",
  GENERATION_CANCELLED: "已取消还没开始的镜头。",
  GENERATION_CANCEL_REQUESTED: "已取消。已经发出去的几段可能停不下来。",
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
