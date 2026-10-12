import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ManualCreativePage } from "./NativeCreativePage";
import type { ComponentProps } from "react";
import type { ManualCreativeEditor } from "./ManualCreativeEditor";

const model = vi.hoisted(() => ({
  backendProjectId: `prj_${"a".repeat(32)}`,
  selectedEpisodeId: `ep_${"b".repeat(32)}`,
  episodes: [{ id: `ep_${"b".repeat(32)}`, project_id: `prj_${"a".repeat(32)}`, title: "第一集" }],
  episodeState: "ready",
  professional: false,
  setNavigationGuard: vi.fn(),
}));
vi.mock("./model", () => ({ useDemo: () => model }));
vi.mock("./ManualCreativeEditor", () => ({
  ManualCreativeEditor: (props: ComponentProps<typeof ManualCreativeEditor>) => (
    <section aria-label="原生共享库编辑器">
      <span>{props.projectId}</span>
      <span>{props.episodeId}</span>
      <span>{props.episodes?.[0]?.title}</span>
      <span>{props.episodeListReady ? "分集已核对" : "分集未核对"}</span>
    </section>
  ),
}));
afterEach(() => {
  cleanup();
  model.professional = false;
});
it("both native modes supply the same scoped verified episode list to the real editor entry", () => {
  const view = render(<ManualCreativePage kind="characters" />);
  expect(screen.getByText(model.backendProjectId)).toBeInTheDocument();
  expect(screen.getByText(model.selectedEpisodeId)).toBeInTheDocument();
  expect(screen.getByText("第一集")).toBeInTheDocument();
  expect(screen.getByText("分集已核对")).toBeInTheDocument();
  model.professional = true;
  view.rerender(<ManualCreativePage kind="characters" />);
  expect(screen.getAllByLabelText("原生共享库编辑器")).toHaveLength(1);
  expect(screen.getByText("分集已核对")).toBeInTheDocument();
});
