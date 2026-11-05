import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "./ContextMenu";

function Target({ items }: { items: ContextMenuItem[] }) {
  const menu = useContextMenu();
  return (
    <>
      <button type="button" onContextMenu={menu.open}>
        镜头 3
      </button>
      <ContextMenu at={menu.at} label="镜头 3 的操作" items={items} onClose={menu.close} />
    </>
  );
}

describe("ContextMenu", () => {
  it("opens where the right-click was, and closes on Esc or a press outside", () => {
    render(<Target items={[{ label: "前移", onSelect: () => {} }]} />);
    expect(screen.queryByRole("menu")).toBeNull();
    const opened = fireEvent.contextMenu(screen.getByRole("button", { name: "镜头 3" }), {
      clientX: 40,
      clientY: 60,
    });
    // The browser's own menu stays away.
    expect(opened).toBe(false);
    expect(screen.getByRole("menu", { name: "镜头 3 的操作" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "前移" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "镜头 3" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does what was chosen and closes; a gray item says why and does nothing", () => {
    const forward = vi.fn();
    const back = vi.fn();
    render(
      <Target
        items={[
          { label: "前移", onSelect: forward, disabledReason: "已经是第一个镜头了" },
          { label: "后移", onSelect: back },
          { label: "删除这一镜", onSelect: () => {}, danger: true, divided: true },
        ]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "镜头 3" }));
    const first = screen.getByRole("menuitem", { name: "前移" });
    expect(first).toHaveAttribute("aria-disabled", "true");
    expect(first).toHaveAttribute("title", "已经是第一个镜头了");
    // The first item that can be done gets the focus.
    expect(screen.getByRole("menuitem", { name: "后移" })).toHaveFocus();
    fireEvent.click(first);
    expect(forward).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getByRole("separator")).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "删除这一镜" })).toHaveClass("nx-context-danger");
    fireEvent.click(screen.getByRole("menuitem", { name: "后移" }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves between the items that can be done with ↑ / ↓, and keeps the arrows to itself", () => {
    render(
      <Target
        items={[
          { label: "前移", onSelect: () => {} },
          { label: "后移", onSelect: () => {}, disabledReason: "已经是最后一个镜头了" },
          { label: "删除这一镜", onSelect: () => {}, danger: true },
        ]}
      />,
    );
    fireEvent.contextMenu(screen.getByRole("button", { name: "镜头 3" }));
    const menu = screen.getByRole("menu");
    const down = fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(down).toBe(false);
    expect(screen.getByRole("menuitem", { name: "删除这一镜" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "前移" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "删除这一镜" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "前移" })).toHaveFocus();
  });
});
