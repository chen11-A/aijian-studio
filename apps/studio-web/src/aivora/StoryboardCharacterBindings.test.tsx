import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StoryboardCharacterBindings } from "./StoryboardCharacterBindings";
import { referenceImpact } from "./storyboardReferenceImpact";
import { emptyCreativeContent, type CreativeVersion } from "./adapters/creativeLibrary";
import {
  emptyStoryboardContent,
  newStoryboardShot,
  type StoryboardContent,
} from "./adapters/episodeStoryboard";

const project = `prj_${"a".repeat(32)}`;
const episode = `ep_${"b".repeat(32)}`;
const charId = `chr_${"c".repeat(32)}`;
const costumeId = `cst_${"d".repeat(32)}`;
const refId = `crf_${"e".repeat(32)}`;
function library(): CreativeVersion {
  return {
    project_id: project,
    episode_id: null,
    version_id: `ver_${"f".repeat(32)}`,
    version_number: 1,
    head_revision: 1,
    parent_version_id: null,
    content_hash: `sha256:${"1".repeat(64)}`,
    author_actor_id: "human",
    change_summary: "references",
    created_at: "2026-10-11T00:00:00Z",
    content: {
      ...emptyCreativeContent(project),
      schema_version: "1.2.0",
      relationships: [],
      characters: [
        {
          character_id: charId,
          ordinal: 1,
          name: "林舟",
          role: "",
          description: "",
          appearance: "",
          personality: "",
        },
      ],
      costumes: [
        { costume_id: costumeId, ordinal: 1, character_id: charId, name: "雨衣", description: "" },
      ],
      references: [
        {
          reference_id: refId,
          ordinal: 1,
          character_id: charId,
          costume_id: costumeId,
          asset_id: `asset_${"2".repeat(32)}`,
          asset_version_id: `asv_${"3".repeat(32)}`,
          asset_sha256: "4".repeat(64),
          label: "雨衣参考",
        },
      ],
    },
  };
}
function initial(): StoryboardContent {
  const shot = newStoryboardShot(1, 24)!;
  return {
    ...emptyStoryboardContent(project, episode),
    creative_library_version_id: library().version_id,
    shots: [{ ...shot, character_ids: [charId] }],
  };
}
let latest: StoryboardContent;
function Harness({ locked = false }: { locked?: boolean }) {
  const [content, edit] = useState<StoryboardContent>(initial);
  latest = content;
  return (
    <StoryboardCharacterBindings
      content={content}
      shot={content.shots[0]!}
      library={library()}
      locked={locked}
      edit={edit}
    />
  );
}
beforeEach(() => vi.spyOn(window, "confirm").mockReturnValue(true));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("explicitly selects costume and exact reference IDs in the existing episode draft without approving identity", () => {
  render(<Harness />);
  expect(screen.queryByLabelText("林舟参考：雨衣参考")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("林舟本镜服装"), { target: { value: costumeId } });
  fireEvent.click(screen.getByLabelText("林舟参考：雨衣参考"));
  expect(latest.schema_version).toBe("1.1.0");
  expect("character_bindings" in latest.shots[0]! && latest.shots[0].character_bindings[0]).toEqual(
    { character_id: charId, costume_id: costumeId, reference_ids: [refId] },
  );
  expect(screen.getByText(/不表示身份锁定/)).toBeInTheDocument();
});
it("requires explicit confirmation before removing incompatible references on costume change", () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("林舟本镜服装"), { target: { value: costumeId } });
  fireEvent.click(screen.getByLabelText("林舟参考：雨衣参考"));
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  fireEvent.change(screen.getByLabelText("林舟本镜服装"), { target: { value: "" } });
  expect(screen.getByLabelText("林舟参考：雨衣参考")).toBeChecked();
  fireEvent.change(screen.getByLabelText("林舟本镜服装"), { target: { value: "" } });
  expect(
    "character_bindings" in latest.shots[0]! &&
      latest.shots[0].character_bindings[0]?.reference_ids,
  ).toEqual([]);
});
it("locks choices while an existing write is unresolved", () => {
  render(<Harness locked />);
  expect(screen.getByLabelText("林舟本镜服装")).toBeDisabled();
});
it("disables a stale library version and rejects an edit callback after the episode changes", () => {
  const content = initial();
  const stale = { ...library(), version_id: `ver_${"0".repeat(32)}` };
  const edit = vi.fn();
  const view = render(
    <StoryboardCharacterBindings
      content={content}
      shot={content.shots[0]!}
      library={stale}
      locked={false}
      edit={edit}
    />,
  );
  expect(screen.getByText("固定版本尚未核对，现有选用保留。")).toBeInTheDocument();
  expect(screen.getByLabelText(`${charId}本镜服装`)).toBeDisabled();
  view.rerender(
    <StoryboardCharacterBindings
      content={content}
      shot={content.shots[0]!}
      library={library()}
      locked={false}
      edit={edit}
    />,
  );
  fireEvent.change(screen.getByLabelText("林舟本镜服装"), { target: { value: costumeId } });
  const pendingUpdate = edit.mock.calls[0]![0] as (value: StoryboardContent) => StoryboardContent;
  const otherEpisode = { ...content, episode_id: `ep_${"0".repeat(32)}` };
  expect(pendingUpdate(otherEpisode)).toBe(otherEpisode);
});
it("includes reference hash changes and wrong costume ownership in whole-episode upgrade impact", () => {
  const original = library();
  const target = library();
  if (target.content.schema_version !== "1.2.0") throw new Error("Fixture schema");
  target.content.references[0]!.asset_sha256 = "5".repeat(64);
  const base = initial();
  const shot = base.shots[0]!;
  const content: StoryboardContent = {
    ...base,
    schema_version: "1.1.0",
    shots: [
      {
        ...shot,
        character_bindings: [
          { character_id: charId, costume_id: costumeId, reference_ids: [refId] },
        ],
      },
    ],
  };
  expect(referenceImpact("library", content, original, target).changed).toHaveLength(1);
  target.content.costumes[0]!.character_id = `chr_${"0".repeat(32)}`;
  expect(referenceImpact("library", content, original, target).missing).toContainEqual(
    expect.stringContaining("服装归属不一致"),
  );
});
