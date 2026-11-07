import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ShotAudioSuggestionDialog } from "./ShotAudioSuggestionDialog";
import { soundPlan } from "./shot-audio-suggestions.test-fixture";
const input = {
  projectId: "private-project",
  shotId: "private-shot",
  takeId: "private-take",
  expectedProjectHash: "e".repeat(64),
};
it("shows all segments, exact times, fades, automation and every note without runtime identities", () => {
  const plan = soundPlan(input);
  render(
    <ShotAudioSuggestionDialog
      plan={plan}
      busy={false}
      message=""
      onRefresh={() => {}}
      onClose={() => {}}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "本镜声音建议" });
  expect(within(dialog).getAllByRole("article")).toHaveLength(4);
  expect(within(dialog).getByRole("heading", { name: "音效 · 2 段" })).toBeVisible();
  expect(dialog).toHaveTextContent("0.1235");
  expect(dialog).toHaveTextContent("起点 -0.5 秒");
  expect(dialog).toHaveTextContent("-32 dB");
  for (const note of [...plan.warnings, ...plan.limitations])
    expect(dialog).toHaveTextContent(note.message);
  expect(within(dialog).getAllByRole("link", { name: "查看素材来源" })).toHaveLength(4);
  expect(dialog).not.toHaveTextContent("private-");
  expect(dialog).not.toHaveTextContent("segment-");
  expect(within(dialog).queryByRole("button", { name: /加入|撤销|选用/ })).toBeNull();
});
it("keeps close available while reading, prevents duplicate refresh, and safely displays long metadata", () => {
  const plan = soundPlan(input);
  plan.clips[0]!.asset.name = "长素材名".repeat(100) + "<script>not HTML</script>";
  plan.clips[0]!.asset.source = "file:///private/source.wav";
  const close = vi.fn(),
    refresh = vi.fn();
  render(
    <ShotAudioSuggestionDialog plan={plan} busy message="" onRefresh={refresh} onClose={close} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "刷新建议" }));
  expect(refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(close).toHaveBeenCalledOnce();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.getByRole("dialog")).not.toHaveTextContent("private/source");
});
it.each(["MUSIC_MOOD_UNDECIDED", "MUSIC_DISABLED", "MUSIC_MATCH_MISSING"] as const)(
  "explains empty lanes for %s without inventing audio",
  (code) => {
    const plan = { ...soundPlan(input), clips: [], warnings: [{ code, message: "需人工核对" }] };
    render(
      <ShotAudioSuggestionDialog
        plan={plan}
        busy={false}
        message=""
        onRefresh={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getAllByRole("heading", { name: /· 0 段/ })).toHaveLength(3);
    expect(screen.getByRole("region", { name: "配乐建议" })).toHaveTextContent(
      code === "MUSIC_DISABLED" ? "留白" : code === "MUSIC_MATCH_MISSING" ? "没有匹配" : "待决定",
    );
  },
);
