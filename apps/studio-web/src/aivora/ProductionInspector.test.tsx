import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Inspector } from "./Inspector";

const state = vi.hoisted(() => ({
  isFixture: false,
  page: "storyboard",
  backendProjectId: "prj_real",
  selectedEpisodeId: "ep_real",
  projects: [{ backendId: "prj_real", name: "真实作品" }],
  episodes: [{ project_id: "prj_real", id: "ep_real", title: "真实剧集" }],
}));
vi.mock("./model", async (original) => ({
  ...(await original<object>()),
  useDemo: () => state,
}));
afterEach(cleanup);

describe("production inspector honesty", () => {
  it.each(["storyboard", "generation", "assembly", "review", "script"])(
    "%s never falls through to sample object fields",
    (page) => {
      state.page = page;
      render(<Inspector />);
      expect(screen.getByLabelText("真实作品属性面板")).toBeInTheDocument();
      expect(screen.getByText("真实作品")).toBeInTheDocument();
      expect(screen.getByText("真实剧集")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("尚未接入");
      expect(screen.queryByText(/演示属性|Shot 000|Aivora-Video Pro/)).not.toBeInTheDocument();
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    },
  );
});
