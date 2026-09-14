import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useDemo } from "./model";

/** A transient action menu; inline disclosures keep their own behavior. */
export function Dropdown({
  className,
  summary,
  label,
  title,
  summaryClassName,
  children,
}: {
  className: string;
  summary: ReactNode;
  label?: string;
  title?: string;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const d = useDemo();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDetailsElement>(null);
  const trigger = useRef<HTMLElement>(null);
  const context = `${d.page}:${d.professional}:${d.aiOpen}:${d.rightTab}:${d.value("managementAI")}`;
  useEffect(() => setOpen(false), [context]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("click", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("click", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <details
      ref={root}
      className={className}
      open={open}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest("button, a")) {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <summary
        ref={trigger}
        className={summaryClassName}
        aria-label={label}
        aria-expanded={open}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          setOpen((old) => !old);
        }}
      >
        {summary}
      </summary>
      {children}
    </details>
  );
}
