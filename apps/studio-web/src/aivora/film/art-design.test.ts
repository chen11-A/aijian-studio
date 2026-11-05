import { webcrypto } from "node:crypto";
import { beforeEach, vi } from "vitest";
import { saveFilm, readSaved } from "./library";
import { hydrateFilm } from "../pro/workflow";
import { filmPipelineFingerprint } from "../pro/film-pipeline-controller";
import { setFilmStyle } from "./style-bible";
import { firstFrameReferences } from "./operations";
import { keyframePrompt } from "./project";
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  window.localStorage.clear();
});
import { expect, it } from "vitest";
import fixtures from "./fixtures/claude-6a77ebd-examples.json";
import { mergeArtDesign, parseArtDesign } from "./art-design";
import { artFromModel } from "./phase2";
import { sampleFilm, upgradeFilm } from "./project";
import { planArtDraft } from "../pro/actions/art";
import {
  applyArtTransaction,
  prepareArtTransaction,
  undoArtTransaction,
} from "../pro/actions/art-transaction";
import { runPipelineAgentAction } from "../pro/pipeline-agent-actions";

// Unmodified design examples, source commit and paths are recorded in the fixture manifest.
for (const entry of fixtures.examples.filter((item) => item.role === "art")) {
  it(`${entry.example.id}: preserves declared design through manual/pipeline snapshots and transaction restore`, async () => {
    expect(fixtures.sourceCommit).toBe("6a77ebddc74af492baaf1bec19288706980e81f4");
    const output = entry.example.output;
    const expected = parseArtDesign(output)!;
    const raw = output as Record<string, unknown>;
    for (const key of [
      "style_status",
      "preset",
      "era",
      "palette",
      "lighting",
      "lens",
      "grain",
      "contrast",
      "texture",
      "aspect",
      "prompt_block_en",
      "avoid",
      "portraits",
    ] as const)
      expect(expected[key], key).toEqual(raw[key]);
    for (const key of ["identities", "locations", "props"] as const) {
      const source = raw[key] as Record<string, unknown>[];
      expect(expected[key]).toHaveLength(source.length);
      expected[key]?.forEach((row, index) => {
        expect(row).toMatchObject({ name: source[index]!.name });
        for (const [field, value] of Object.entries(row))
          expect(value, `${key}.${field}`).toEqual(source[index]![field]);
      });
    }
    expect(expected.palette).toHaveLength(5);
    expect(expected.portraits!.length).toBeGreaterThan(0);
    expect(expected.props![0]!.prompt).toBeTruthy();
    expect(artFromModel(output)?.design).toEqual(expected);
    const film = sampleFilm();
    const request = async () => ({ text: JSON.stringify(output), detail: "" });
    const draft = await planArtDraft(film, { request, current: () => true });
    expect(draft.status).toBe("ready");
    if (draft.status !== "ready") throw new Error("draft missing");
    const tx = prepareArtTransaction(film, draft.draft, { projectId: film.id, page: "cast" });
    expect(tx.unsupported).toEqual([]);
    const applied = applyArtTransaction(film, tx);
    expect(applied.receipt).toBeTruthy();
    const restored = upgradeFilm(JSON.parse(JSON.stringify(applied.film)))!;
    expect(restored.artDesign).toEqual(expected);
    expect(restored.artDesignBaseline).toEqual(expected);
    expect(restored.characters.map((person) => person.portraits)).toEqual(
      film.characters.map((person) => person.portraits),
    );
    expect(restored.locations.every((place) => !place.referenceImage)).toBe(true);
    expect(restored.aspectRatio).toBe(film.aspectRatio);
    expect(restored.styleZh).not.toBe(expected.prompt_block_en);
    const undone = undoArtTransaction(restored, tx);
    expect(undone.receipt).toBeTruthy();
    expect(undone.film.artDesign).toBeUndefined();
    const pipeline = await runPipelineAgentAction(
      film,
      { step: "art", targetId: "art" },
      { request, valid: () => true },
    );
    expect(pipeline.status).toBe("done");
    expect(upgradeFilm(JSON.parse(JSON.stringify(pipeline.film)))?.artDesign).toEqual(expected);
    await saveFilm(pipeline.film!);
    const reloaded = await hydrateFilm((await readSaved(film.id))!);
    expect(reloaded.artDesign).toEqual(expected);
    expect(await filmPipelineFingerprint(reloaded)).toBe(
      await filmPipelineFingerprint(pipeline.film!),
    );
    expect(await filmPipelineFingerprint(reloaded)).not.toBe(await filmPipelineFingerprint(film));
    const restyled = setFilmStyle(reloaded, "用户指定水墨画风");
    expect(keyframePrompt(restyled.shots[0]!, restyled)).toContain("用户指定水墨画风");
    expect(keyframePrompt(restyled.shots[0]!, restyled)).not.toContain(expected.prompt_block_en);
    expect(firstFrameReferences(restyled, restyled.shots[0]!)).toEqual(
      firstFrameReferences(film, film.shots[0]!),
    );

    const edited = { ...restored, artDesign: { ...expected, lighting: "用户指定灯光" } };
    expect(undoArtTransaction(edited, tx).receipt).toBeNull();
    expect(
      applyArtTransaction({ ...film, artDesign: { lighting: "后来编辑" } }, tx).receipt,
    ).toBeNull();
  });
}
it("retains edited and legacy metadata, accumulates declarations without creating assets", () => {
  const first = mergeArtDesign(undefined, undefined, {
    lighting: "暖光",
    portraits: [{ asset_id: "a", name: "甲" }],
    asset_ids: ["a"],
  });
  expect(
    mergeArtDesign(first.artDesign, first.artDesignBaseline, { lighting: "新冷光" }).artDesign
      .lighting,
  ).toBe("新冷光");
  const updated = mergeArtDesign(
    { ...first.artDesign, lighting: "用户柔光" },
    first.artDesignBaseline,
    {
      lighting: "冷光",
      portraits: [{ asset_id: "b", name: "乙", costume_id: null }],
      asset_ids: ["b"],
    },
  );
  expect(updated.artDesign.lighting).toBe("用户柔光");
  expect(updated.artDesign.portraits?.map((row) => row.asset_id)).toEqual(["a", "b"]);
  expect(updated.artDesign.asset_ids).toEqual(["a", "b"]);
  expect(mergeArtDesign({ era: "用户年代" }, undefined, { era: "当代" }).artDesign.era).toBe(
    "用户年代",
  );
  expect(
    parseArtDesign({
      asset_ids: ["declared", 42],
      portraits: [{ asset_id: "x", costume_id: null, url: "/fake.png" }],
      arbitrary: "ignored",
    }),
  ).toEqual({ asset_ids: ["declared"], portraits: [{ asset_id: "x", costume_id: null }] });
});
