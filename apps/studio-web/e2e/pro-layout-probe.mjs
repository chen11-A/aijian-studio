/** Browser-only geometry probe for the actual ProWorkspace, not the fixture/hash shell. */
export function probeProLayout({ scopeSelector = ".pro-root" } = {}) {
  const scope = document.querySelector(scopeSelector);
  if (!scope) throw new Error("ProWorkspace root is missing");
  const issues = [];
  const scrollOffscreen = [];
  const bounds = (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
  // Public diagnostics are identifiers from fixed UI labels, never arbitrary DOM text/IDs.
  const controlLabels = new Map([
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
  ]);
  const controlIds = new Set(["export-quality", "export-aspect", "export-dir"]);
  const safeClasses = new Set([
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
      )
        hiddenClip = true;
      if (
        /hidden|clip/.test(css.overflowY) &&
        !scrollY &&
        (box.top < parent.top - 2 || box.bottom > parent.bottom + 2)
      )
        hiddenClip = true;
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
      issues.push({ kind: "control-clipped-without-scroll", label, box: bounds(box) });
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
            control: controlIds.has(element.id)
              ? element.id
              : (controlLabels.get(label) ?? "other"),
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
