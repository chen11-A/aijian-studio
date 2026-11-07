/** Browser-only geometry probe for the actual ProWorkspace, not the fixture/hash shell. */
export function probeProLayout({ scopeSelector = ".pro-root" } = {}) {
  const scope = document.querySelector(scopeSelector);
  if (!scope) throw new Error("ProWorkspace root is missing");
  const issues = [];
  const scrollOffscreen = [];
  const bounds = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  // Public diagnostics are identifiers from fixed UI labels, never arbitrary DOM text/IDs.
  const controlLabels = new Map([
    ["查看可核对的视频记录", "recovery-open"],
    ["找回原素材", "recovery-get"],
    ["另存原素材", "recovery-save"],
    ["重新读取列表", "recovery-refresh"],
    ["技术记录（不代表观看或试听）", "delivery-technical"],
    ["导出设置与实际选材记录", "delivery-selection"],
    ["找人物", "legacy-person-search"],
    ["取消多选", "legacy-cancel-multi"],
    ["先不生成", "legacy-batch-cancel"],
    ["开始生成", "legacy-batch-confirm"],
    ["安全框", "preview-safe"],
    ["全屏预览 (F)", "preview-fullscreen"],
    ["退出全屏 (Esc)", "preview-exit-fullscreen"],
    ["看全片", "timeline-fit"],
    ["查看试片候选", "risk-open"],
    ["在分镜查看", "risk-inspect"],
    ["刷新候选", "risk-refresh"],
    ["设置视频提交失败上限", "policy-open"],
    ["保存上限", "policy-save"],
    ["正在保存…", "policy-saving"],
    ["新的上限（整数 0–1000）", "policy-limit"],
    ["提到人物、场景或镜头", "reference-menu"],
    ["跟助手说", "reference-input"],
    ["人物名字", "reference-name"],
    ["发送", "reference-send"],
    ["正在和：", "reference-role"],
    ["播放", "timeline-play"],
    ["暂停", "timeline-pause"],
    ["设入点", "timeline-mark-in"],
    ["设出点", "timeline-mark-out"],
    ["查看完整句拆镜方案", "dialogue-split-open"],
    ["重新检查", "dialogue-split-refresh"],
    ["接受这份拆镜结构", "dialogue-split-apply"],
    ["我已核对完整台词、旧素材去向与新增视频数量", "dialogue-split-accept"],
    ["核对拆镜保存结果", "dialogue-split-recover"],
    ["查看两份状态", "dialogue-split-conflict"],
    ["采用已核对的拆镜版并放弃这份保留稿", "dialogue-split-adopt"],
    ["拆镜保留稿文字备忘", "dialogue-split-memo"],
    ["查看并复制保留稿的文字备忘", "dialogue-split-copy"],

    ["查看本镜声音建议", "shot-audio-open"],
    ["查看本场声音建议", "scene-audio-open"],
    ["刷新建议", "shot-audio-refresh"],
    ["选用所选轨道的完整建议", "shot-audio-apply"],
    ["选用本地音效/配乐", "library-open"],
    ["加入当前版本", "library-add"],
    ["核对当前版本时长", "library-target-refresh"],
    ["查找名称或类别", "library-search"],
    ["加入轨道", "library-lane"],
    ["使用时长（秒）", "library-duration"],
    ["开始时间（镜头内，秒）", "library-start"],
    ["素材起点（秒）", "library-offset"],
    ["片段音量（dB）", "library-gain"],
    ["循环到所选时长", "library-loop"],
    ["核对这部作品", "library-recover"],
    ["查看冲突处理", "library-conflict"],
    ["采用已保存版本并放弃这份未保存稿", "library-adopt-saved"],
    ["未保存稿文字备忘", "library-draft-memo"],
    ["对白音量", "mix-dialogue-volume"],
    ["静音对白", "mix-dialogue-mute"],
    ["单听对白", "mix-dialogue-solo"],
    ["环境音音量", "mix-ambience-volume"],
    ["静音环境音", "mix-ambience-mute"],
    ["单听环境音", "mix-ambience-solo"],
    ["音效音量", "mix-sfx-volume"],
    ["静音音效", "mix-sfx-mute"],
    ["单听音效", "mix-sfx-solo"],
    ["配乐音量", "mix-score-volume"],
    ["静音配乐", "mix-score-mute"],
    ["单听配乐", "mix-score-solo"],
    ["重试音轨试听", "mix-preview-retry"],
    ["整理视频说明", "video-organize"],
    ["确认视频说明", "video-confirm"],
    ["关闭说明", "video-review-close"],
    ["本次完整提交文本", "video-prompt-text"],
    ["选择保存位置并打包", "archive-export"],
    ["选择工程包", "archive-import"],
    ["打开工程包", "archive-open-menu"],
    ["导出工程包", "archive-export-menu"],
    ["作品", "work-menu"],
    ["合成第2集", "work-other-episode"],
    ["分镜画面", "video-picture"],

    ["审核后发布", "review-publish"],
    ["取消本次导出", "review-cancel"],
    ["关闭", "dialog-close"],
    ["检查成片", "prepare-check"],
    ["改封面", "cover-edit"],
    ["高级", "advanced"],
    ["烧进画面", "subtitle-burn"],
    ["单独文件", "subtitle-srt"],
    ["不要", "subtitle-none"],
    ["停止处理", "request-stop"],
    ["正在请求停止", "request-pending"],
    ["刷新音频波形", "waveform-refresh"],
    ["读取波形中", "waveform-loading"],
    ["重新生成", "timeline-regenerate"],
    ["换配音", "timeline-voice"],
    ["剪掉", "timeline-cut"],
    ["取消选择", "timeline-clear-selection"],
    ["放大时间线", "timeline-zoom-in"],
    ["缩小时间线", "timeline-zoom-out"],
    ["改这一镜的描述", "shot-description"],
    ["导入音乐", "music-import"],
  ]);
  const controlIds = new Set(["export-quality", "export-aspect", "export-dir"]);
  const safeClasses = new Set([
    "generation-video-recovery",
    "recovery-list",
    "reference-summary",
    "mention-menu",
    "nx-suggest",
    "nx-field-diff",
    "shot-audio-suggestions",
    "shot-audio-lane",
    "shot-audio-envelope",
    "shot-audio-groups",
    "bundled-audio-dialog",
    "bundled-audio-list",
    "bundled-audio-body",
    "nx-video-review",
    "nx-video-model",
    "nx-video-facts",
    "project-archive",
    "pgroup",
    "acts",
    "dialog",
    "export",
    "dialog-back",
    "nx-export-foot",
    "nx-export",
    "nx-export-cols",
    "nx-export-side",
    "nx-panel",
    "nx-panel-body",
    "nx-panel-head",
    "nx-export-issues",
    "nx-export-state",
    "nx-export-progress",
    "nx-primary",
    "nx-btn",
    "btn",
    "primary",
    "sp",
    "nx-adv",
    "nx-scroll",
    "nx-export-facts",
    "ws",
    "fix",
    "edit",
    "pane",
    "pb",
    "sheet",
    "field",
    "monitor",
    "timeline",
    "ttool",
    "tbody",
    "tracks",
    "bin",
  ]);
  const safeTags = new Set([
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "SUMMARY",
    "DIV",
    "SPAN",
    "P",
    "SECTION",
    "ASIDE",
    "FOOTER",
    "HEADER",
    "MAIN",
    "LABEL",
    "H1",
    "H2",
    "H3",
    "PROGRESS",
    "BODY",
    "HTML",
  ]);
  const tag = (element) => (safeTags.has(element.tagName) ? element.tagName : "OTHER");
  const controlName = (element, label) => {
    if (element.matches('.mention-menu button[role="menuitem"]')) return "reference-option";
    if (element.closest(".nx-suggest") && element.tagName === "BUTTON") {
      const fixed = {
        确认修改: "reference-confirm",
        撤销: "reference-undo",
        不要: "reference-reject",
      };
      if (Object.hasOwn(fixed, label)) return fixed[label];
    }
    if (element.tagName === "BUTTON" && /^(重新)?生成这 [1-9]\d{0,2} 个$/.test(label))
      return "legacy-batch-open";
    if (element.tagName === "BUTTON" && /^删除这 [1-9]\d{0,2} 个$/.test(label))
      return "legacy-delete-shots";
    if (element.matches('.risk-trial-review input[type="radio"]')) return "risk-candidate";
    if (element.matches("button.clip.v")) return "timeline-video";
    if (element.tagName === "INPUT" && element.closest(".shot-audio-choice")) {
      const text = element.closest("label")?.textContent.replace(/\s+/g, " ").trim() ?? "";
      const match = /^(环境音|音效|配乐) · 完整 (\d{1,3}) 段$/.exec(text);
      if (match && Number(match[2]) <= 128)
        return `shot-audio-lane-${{ 环境音: "ambience", 音效: "sfx", 配乐: "score" }[match[1]]}`;
    }
    if (
      element.tagName === "BUTTON" &&
      element.closest(".shot-audio-groups") &&
      /^移除第[1-9]\d{0,3}组声音$/.test(label)
    )
      return "shot-audio-remove-group";
    if (element.classList.contains("bundled-audio-item")) return "library-asset";
    if (element.closest(".bundled-audio-used-row") && element.tagName === "BUTTON")
      return "library-remove";
    if (element.tagName === "BUTTON" && /^拆镜保存待核对（\d+）$/.test(label))
      return "dialogue-split-pending";
    if (element.tagName === "BUTTON" && /^本地素材保存待核对（\d+）$/.test(label))
      return "library-pending";
    if (element.closest(".bundled-audio-dialog") && element.labels?.length)
      return (
        controlLabels.get(element.labels[0].textContent.replace(/\s+/g, " ").trim()) ?? "other"
      );
    return controlLabels.get(label) ?? "other";
  };
  for (const element of scope.querySelectorAll("button,input,select,textarea,summary")) {
    if (element.closest("[hidden]")) continue;
    const closed = element.closest("details:not([open])");
    if (closed && !(element.tagName === "SUMMARY" && element.parentElement === closed)) continue;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      box.width < 2 ||
      box.height < 2
    )
      continue;
    const label = (
      element.getAttribute("aria-label") ||
      element.innerText ||
      element.getAttribute("title") ||
      element.tagName
    )
      .replace(/\s+/g, " ")
      .slice(0, 100);
    const visible = {
      left: Math.max(0, box.left),
      right: Math.min(window.innerWidth, box.right),
      top: Math.max(0, box.top),
      bottom: Math.min(window.innerHeight, box.bottom),
    };
    if (element.tagName === "BUTTON" && element.scrollWidth > element.clientWidth + 2) {
      issues.push({
        kind: "button-content-overflow",
        label,
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      });
    }
    let scrollX = false;
    let scrollY = false;
    let hiddenClip = false;
    let clipAncestor = null;
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor);
      const parent = ancestor.getBoundingClientRect();
      scrollX ||=
        /auto|scroll/.test(css.overflowX) && ancestor.scrollWidth > ancestor.clientWidth + 2;
      scrollY ||=
        /auto|scroll/.test(css.overflowY) && ancestor.scrollHeight > ancestor.clientHeight + 2;
      if (
        /hidden|clip/.test(css.overflowX) &&
        !scrollX &&
        (box.left < parent.left - 2 || box.right > parent.right + 2)
      ) {
        hiddenClip = true;
        clipAncestor ??= ancestor;
      }
      if (
        /hidden|clip/.test(css.overflowY) &&
        !scrollY &&
        (box.top < parent.top - 2 || box.bottom > parent.bottom + 2)
      ) {
        hiddenClip = true;
        clipAncestor ??= ancestor;
      }
      if (/hidden|clip|auto|scroll/.test(css.overflowX)) {
        visible.left = Math.max(visible.left, parent.left);
        visible.right = Math.min(visible.right, parent.right);
      }
      if (/hidden|clip|auto|scroll/.test(css.overflowY)) {
        visible.top = Math.max(visible.top, parent.top);
        visible.bottom = Math.min(visible.bottom, parent.bottom);
      }
      if (ancestor === scope) break;
    }
    if (hiddenClip)
      issues.push({
        kind: "control-clipped-without-scroll",
        label,
        box: bounds(box),
        diagnostic: {
          control: controlIds.has(element.id) ? element.id : controlName(element, label),
          tag: tag(element),
          clipTag: clipAncestor ? tag(clipAncestor) : "OTHER",
          clipClasses: clipAncestor
            ? [...clipAncestor.classList].filter((name) => safeClasses.has(name)).slice(0, 3)
            : [],
          clipBox: clipAncestor ? bounds(clipAncestor.getBoundingClientRect()) : null,
          scrollX,
          scrollY,
        },
      });
    if (visible.right - visible.left < 2 || visible.bottom - visible.top < 2) {
      const item = { kind: "offscreen-control", label, box: bounds(box) };
      if (!hiddenClip && (scrollX || scrollY)) scrollOffscreen.push(item);
      else if (!hiddenClip) issues.push(item);
      continue;
    }
    if (!element.disabled) {
      const point = {
        x: (visible.left + visible.right) / 2,
        y: (visible.top + visible.bottom) / 2,
      };
      const hit = document.elementFromPoint(point.x, point.y);
      if (hit && !element.contains(hit) && !hit.contains(element))
        issues.push({
          kind: "covered-center",
          label,
          hit: `${hit.tagName}.${hit.className}`,
          box: bounds(box),
          diagnostic: {
            control: controlIds.has(element.id) ? element.id : controlName(element, label),
            tag: tag(element),
            hitTag: tag(hit),
            hitClasses: [...hit.classList].filter((name) => safeClasses.has(name)).slice(0, 3),
            visible: {
              x: visible.left,
              y: visible.top,
              width: visible.right - visible.left,
              height: visible.bottom - visible.top,
            },
            hitBox: bounds(hit.getBoundingClientRect()),
            point,
            scrollX,
            scrollY,
          },
        });
    }
  }
  const picker = scope.querySelector(".cands > .nx-takes");
  let pickerMetrics = null;
  if (picker) {
    const outer = picker.parentElement;
    const css = getComputedStyle(outer);
    const title = picker.querySelector(".nx-takes-head .nx-faint");
    const range = document.createRange();
    range.selectNodeContents(title);
    pickerMetrics = {
      width: picker.getBoundingClientRect().width,
      availableWidth:
        outer.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
      title: title.textContent.trim(),
      titleLines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
      cardWidths: [...picker.querySelectorAll(".nx-take")].map(
        (card) => card.getBoundingClientRect().width,
      ),
    };
    if (Math.abs(pickerMetrics.width - pickerMetrics.availableWidth) > 2)
      issues.push({ kind: "picker-not-full-width", ...pickerMetrics });
    if (pickerMetrics.titleLines !== 1)
      issues.push({ kind: "picker-count-wraps", ...pickerMetrics });
    for (const card of picker.querySelectorAll(".nx-take")) {
      const parent = card.getBoundingClientRect();
      for (const child of card.querySelectorAll(
        ".nx-take-use .nx-tag,.nx-take-use .nx-btn,.nx-take-head strong",
      )) {
        const box = child.getBoundingClientRect();
        if (
          box.left < parent.left - 1 ||
          box.right > parent.right + 1 ||
          box.top < parent.top - 1 ||
          box.bottom > parent.bottom + 1
        )
          issues.push({
            kind: "candidate-content-outside-card",
            label: child.textContent.trim(),
            child: bounds(box),
            card: bounds(parent),
          });
        if (
          box.left < 0 ||
          box.right > window.innerWidth ||
          box.top < 0 ||
          box.bottom > window.innerHeight
        )
          issues.push({
            kind: "candidate-control-outside-viewport",
            label: child.textContent.trim(),
            box: bounds(box),
          });
      }
    }
  }
  const documentOverflow = {
    x: document.documentElement.scrollWidth > window.innerWidth + 2,
    y: document.documentElement.scrollHeight > window.innerHeight + 2,
  };
  if (documentOverflow.x || documentOverflow.y)
    issues.push({ kind: "document-overflow", ...documentOverflow });
  return {
    scopeSelector,
    scopeMetrics: {
      scrollTop: scope.scrollTop,
      scrollHeight: scope.scrollHeight,
      clientHeight: scope.clientHeight,
      box: bounds(scope.getBoundingClientRect()),
    },
    stage: document.querySelector(".pro-root")?.getAttribute("data-stage"),
    documentOverflow,
    pickerMetrics,
    issues,
    scrollOffscreen,
  };
}
