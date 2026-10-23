import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import "./select.css";

type Option = { value: string; label: string; disabled: boolean };

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) {
    const element = node as { props?: { children?: ReactNode } };
    return textOf(element.props?.children);
  }
  return "";
}

function optionsFrom(children: ReactNode): Option[] {
  const options: Option[] = [];
  const visit = (nodes: ReactNode) => {
    if (nodes == null || typeof nodes === "boolean") return;
    if (typeof nodes === "string" || typeof nodes === "number") return;
    if (Array.isArray(nodes)) {
      nodes.forEach(visit);
      return;
    }
    if (typeof nodes !== "object" || !("props" in nodes)) return;
    const element = nodes as {
      type?: unknown;
      props?: { value?: string | number; children?: ReactNode; disabled?: boolean };
    };
    if (element.type === "option") {
      const label = textOf(element.props?.children).trim();
      const value = element.props?.value === undefined ? label : String(element.props.value);
      options.push({ value, label: label || value, disabled: Boolean(element.props?.disabled) });
      return;
    }
    visit(element.props?.children);
  };
  visit(children);
  return options;
}

function emitChange(onChange: SelectProps["onChange"], value: string) {
  const target = { value };
  onChange?.({
    target,
    currentTarget: target,
  } as ChangeEvent<HTMLSelectElement>);
}

/**
 * Native select popups on Linux and Windows deliver the option click to whatever
 * sits underneath, so the value never changes. The real app uses a listbox.
 * Vitest keeps a native select so existing change events stay valid.
 */
export function Select(props: SelectProps) {
  if (import.meta.env.MODE === "test") return <select {...props} />;
  return <MouseSelect {...props} />;
}

export function MouseSelect({
  children,
  value,
  defaultValue,
  onChange,
  disabled,
  name,
  id,
  className,
  required,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SelectProps) {
  const options = optionsFrom(children);
  const controlled = value !== undefined;
  const [uncontrolled, setUncontrolled] = useState(
    defaultValue === undefined ? (options[0]?.value ?? "") : String(defaultValue),
  );
  const current = controlled ? String(value ?? "") : uncontrolled;
  const selected = options.find((option) => option.value === current) ?? options[0];
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const [box, setBox] = useState<{
    top: number;
    left: number;
    width: number;
    lift: boolean;
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const face = button.current?.getBoundingClientRect();
      if (!face) return;
      const spaceBelow = window.innerHeight - face.bottom;
      setBox({
        top: spaceBelow < 220 && face.top > spaceBelow ? face.top - 4 : face.bottom + 4,
        left: Math.min(face.left, window.innerWidth - 16),
        width: Math.max(face.width, 180),
        lift: spaceBelow < 220 && face.top > spaceBelow,
      });
    };
    place();
    const outside = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (root.current?.contains(target) || menu.current?.contains(target)) return;
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  function choose(next: string) {
    if (!controlled) setUncontrolled(next);
    emitChange(onChange, next);
    setOpen(false);
    button.current?.focus();
  }

  function move(delta: number) {
    const enabled = options
      .map((option, index) => ({ option, index }))
      .filter((item) => !item.option.disabled);
    if (!enabled.length) return;
    const currentIndex = enabled.findIndex((item) => item.index === active);
    const next = enabled[(currentIndex + delta + enabled.length) % enabled.length] ?? enabled[0];
    if (next) setActive(next.index);
  }

  const host =
    (button.current?.closest("dialog") as HTMLElement | null) ??
    (typeof document === "undefined" ? null : document.body);

  const menuNode =
    open && box && host ? (
      <ul
        ref={menu}
        id={listId}
        role="listbox"
        className={`mouse-select-menu${box.lift ? " is-lifted" : ""}`}
        style={
          host.tagName === "DIALOG"
            ? {
                position: "absolute",
                top: box.lift ? undefined : box.top - host.getBoundingClientRect().top,
                bottom: box.lift ? host.getBoundingClientRect().bottom - box.top : undefined,
                left: box.left - host.getBoundingClientRect().left,
                minWidth: box.width,
              }
            : {
                position: "fixed",
                top: box.lift ? undefined : box.top,
                bottom: box.lift ? window.innerHeight - box.top : undefined,
                left: box.left,
                minWidth: box.width,
              }
        }
      >
        {options.map((option, index) => (
          <li key={`${option.value}:${index}`} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={option.value === current}
              disabled={option.disabled}
              className={index === active ? "is-active" : ""}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!option.disabled) choose(option.value);
              }}
            >
              {option.label}
            </button>
          </li>
        ))}
      </ul>
    ) : null;

  return (
    <span ref={root} className={`mouse-select${className ? ` ${className}` : ""}`}>
      <button
        ref={button}
        id={id}
        type="button"
        className="mouse-select-face"
        role="combobox"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((was) => {
            if (!was) {
              const index = Math.max(
                0,
                options.findIndex((option) => option.value === current),
              );
              setActive(index);
            }
            return !was;
          });
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) setOpen(true);
            else move(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            else move(-1);
          } else if ((event.key === "Enter" || event.key === " ") && open) {
            event.preventDefault();
            const option = options[active];
            if (option && !option.disabled) choose(option.value);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{selected?.label || "未选择"}</span>
      </button>
      <select
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        name={name}
        required={required}
        disabled={disabled}
        value={current}
        onChange={(event) => emitChange(onChange, event.target.value)}
      >
        {options.map((option, index) => (
          <option key={`${option.value}:${index}`} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {menuNode && host ? createPortal(menuNode, host) : null}
    </span>
  );
}
