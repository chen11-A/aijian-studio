import { useEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon } from "./Icon";
import { useDemo } from "./model";
import { flow, pages } from "./data";
import { V2ImageViewer } from "./V2ImageViewer";
import { v2PageCopy } from "./v2-page-copy";

export function Button({
  children,
  icon,
  iconAfter,
  primary,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: string;
  iconAfter?: boolean;
  primary?: boolean;
}) {
  return (
    <button type="button" className={primary ? "button primary" : "button"} {...props}>
      {icon && !iconAfter && <Icon name={icon} />}
      {children}
      {icon && iconAfter && <Icon name={icon} />}
    </button>
  );
}
export function Pill({ children, tone = "" }: { children: ReactNode; tone?: string }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}
export function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-heading">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function PageTitle({ actions }: { actions?: ReactNode }) {
  const { page } = useDemo();
  return (
    <div className="page-title">
      <div>
        <h1>{v2PageCopy[page]?.title || pages[page][0]}</h1>
        <p>{v2PageCopy[page]?.description || pages[page][1]}</p>
      </div>
      <div className="actions">{actions}</div>
    </div>
  );
}
export function Tabs({
  items,
  value,
  onChange,
}: {
  items: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="tabs" role="group">
      {items.map((item) => (
        <button
          key={item}
          className={item === value ? "active" : ""}
          aria-pressed={item === value}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}
export function Info({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="info-card">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
export function FlowFooter({
  label,
  action,
  disabled,
  reason,
  secondaryLabel,
  secondaryAction,
}: {
  label?: string;
  action?: () => void;
  disabled?: boolean;
  reason?: string;
  secondaryLabel?: string;
  secondaryAction?: () => void;
}) {
  const d = useDemo();
  const index = flow.indexOf(d.page);
  const next = flow[index + 1];
  const previous = flow[index - 1];
  return (
    <footer className="flow-footer">
      <Button
        icon={secondaryAction ? "edit" : "back"}
        onClick={secondaryAction ?? (() => (previous ? d.go(previous) : d.back()))}
      >
        {secondaryLabel ?? "上一步"}
      </Button>
      <span>
        <Icon name="check" size={18} />
        {reason ?? "演示内容 · 你的决定始终保留"}
      </span>
      {(next || action) && (
        <Button
          primary
          icon="arrow"
          iconAfter
          disabled={disabled}
          title={reason}
          onClick={
            action ??
            (() => {
              d.put("lastPage", next!);
              d.go(next!);
            })
          }
        >
          {label ?? `下一步：${next ? pages[next][0] : "继续"}`}
        </Button>
      )}
    </footer>
  );
}
export function StateView() {
  const d = useDemo();
  if (d.scenario === "normal") return null;
  const states = {
    empty: ["这里还没有内容", "从添加当前页面的第一个对象开始。"],
    loading: ["正在加载演示内容", "这是可控的加载状态，用于检查页面结构。"],
    error: ["内容暂时无法加载", "演示错误：连接超时。已有输入仍保留。"],
    unavailable: ["这项能力尚未接入", "界面演示不包含真实供应商、视频生成或正式导出能力。"],
  };
  const [title, description] = states[d.scenario];
  return (
    <div className={`state-view ${d.scenario}`} role="status" aria-busy={d.scenario === "loading"}>
      <Icon name={d.scenario === "error" ? "review" : "folder"} size={48} />
      <h2>{title}</h2>
      <p>{description}</p>
      <p className="muted">本页状态：{pages[d.page][3]}</p>
      {d.scenario === "loading" && (
        <div className="skeleton-lines">
          <span />
          <span />
          <span />
        </div>
      )}
      <Button onClick={() => d.setScenario("normal")}>
        {d.scenario === "error" ? "重试演示" : "查看正常示例"}
      </Button>
    </div>
  );
}
export function EditorDialog() {
  const d = useDemo();
  const ref = useRef<HTMLDialogElement>(null);
  const initialFields = useRef("");
  const [discardPrompt, setDiscardPrompt] = useState(false);
  useEffect(() => {
    const dialog = ref.current;
    if (d.editor && dialog && !dialog.open) dialog.showModal();
    const form = dialog?.querySelector("form");
    initialFields.current = form ? JSON.stringify([...new FormData(form)]) : "";
    setDiscardPrompt(false);
  }, [d.editor]);
  if (!d.editor) return null;
  const editor = d.editor;
  const projectCreateState =
    editor.title === "新建项目" ? d.projectCreateState : { kind: "idle" as const };
  const requestClose = () => {
    if (projectCreateState.kind === "SUBMITTING") return;
    const form = ref.current?.querySelector("form");
    if (editor.save && form && JSON.stringify([...new FormData(form)]) !== initialFields.current) {
      setDiscardPrompt(true);
      return;
    }
    d.setEditor(null);
  };
  const validationError = editor.validate?.();
  if (editor.image && !editor.fields?.length && !editor.save && editor.presentation !== "drawer") {
    return (
      <V2ImageViewer
        key={editor.image}
        title={editor.title}
        src={editor.image}
        images={editor.images}
        crop={editor.imageCrop}
        onClose={() => d.setEditor(null)}
      />
    );
  }
  return (
    <dialog
      className={`demo-dialog ${editor.presentation === "drawer" ? "detail-drawer" : ""}`}
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) requestClose();
      }}
    >
      <form
        method="dialog"
        onChange={() => setDiscardPrompt(false)}
        onSubmit={async (event) => {
          event.preventDefault();
          const error = editor.validate?.();
          if (error) {
            d.notify(error);
            return;
          }
          const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<
            string,
            string
          >;
          if ((await editor.save?.(data)) === false) return;
          d.setEditor(null);
        }}
      >
        <header>
          <Pill>内容编辑</Pill>
          <Button aria-label="关闭对话框" icon="close" onClick={requestClose} />
        </header>
        <h2 id="dialog-title">{editor.title}</h2>
        {editor.description && <p className="dialog-description">{editor.description}</p>}
        {projectCreateState.kind === "SUBMITTING" && (
          <p role="status" aria-live="polite">
            正在创建项目，请等待结果后再试。
          </p>
        )}
        {projectCreateState.kind === "REMOTE_UNKNOWN" && (
          <p role="alert">
            创建结果未知。请刷新项目列表后确认，未自动重试。
          </p>
        )}
        {validationError && <p role="alert">{validationError}</p>}
        {editor.image &&
          (editor.imageCrop ? (
            <ReferenceCrop src={editor.image} alt={editor.title} crop={editor.imageCrop} />
          ) : (
            <img className="dialog-image" src={editor.image} alt={editor.title} />
          ))}
        <div className="form-fields">
          {editor.fields?.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.options ? (
                <select name={field.key} defaultValue={field.value}>
                  {field.options.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : field.type === "textarea" ? (
                <textarea name={field.key} defaultValue={field.value} required={field.required} />
              ) : (
                <input
                  name={field.key}
                  defaultValue={field.value}
                  type={field.type ?? "text"}
                  min={field.min ?? (field.type === "number" ? 0.1 : undefined)}
                  max={field.max}
                  step={field.type === "number" ? "any" : undefined}
                  required={field.required}
                />
              )}
            </label>
          ))}
        </div>
        {discardPrompt && (
          <div role="alert">
            <p>有未保存的修改。继续编辑，或放弃本次修改？</p>
            <Button onClick={() => setDiscardPrompt(false)}>继续编辑</Button>
            <Button onClick={() => d.setEditor(null)}>放弃修改并关闭</Button>
          </div>
        )}
        <footer>
          <Button onClick={requestClose} disabled={projectCreateState.kind === "SUBMITTING"}>
            关闭
          </Button>
          {editor.save && (
            <button
              className="button primary"
              type="submit"
              disabled={
                !!validationError ||
                projectCreateState.kind === "SUBMITTING" ||
                projectCreateState.kind === "REMOTE_UNKNOWN"
              }
            >
              {projectCreateState.kind === "SUBMITTING"
                ? "正在创建"
                : editor.confirm ?? "确认"}
            </button>
          )}
        </footer>
      </form>
    </dialog>
  );
}

export function ReferenceCrop({
  src,
  alt,
  crop,
}: {
  src: string;
  alt: string;
  crop: { x: number; y: number; width: number; height: number; sourceWidth: number };
}) {
  return (
    <div className="reference-crop" style={{ aspectRatio: `${crop.width} / ${crop.height}` }}>
      <img
        src={src}
        alt={alt}
        style={{
          width: `${(crop.sourceWidth / crop.width) * 100}%`,
          left: `${(-crop.x / crop.width) * 100}%`,
          top: `${(-crop.y / crop.height) * 100}%`,
        }}
      />
    </div>
  );
}
