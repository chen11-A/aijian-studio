import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { useDismiss } from "./dismiss";

function Menu() {
  const [open, setOpen] = useState(false);
  useDismiss(open, () => setOpen(false), ".wrap");
  return (
    <div>
      <p>画布</p>
      <div className="wrap">
        <button type="button" onClick={() => setOpen((value) => !value)}>
          更多
        </button>
        {open && <div role="menu">菜单</div>}
      </div>
    </div>
  );
}

describe("useDismiss", () => {
  it("closes on Esc and on a press outside, but lets its own button toggle", () => {
    render(<Menu />);
    const toggle = screen.getByRole("button", { name: "更多" });
    fireEvent.click(toggle);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(toggle);
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByText("画布"));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(toggle);
    fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does nothing while closed", () => {
    render(<Menu />);
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerDown(screen.getByText("画布"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
