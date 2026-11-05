import { expect, it, vi } from "vitest";
import { sampleFilm, type FilmProject } from "../../film/project";
import { preparePortraitIdentity, type PortraitIdentityHost } from "./portrait-identity";

function setup() {
  const base = sampleFilm();
  base.characters[0] = { ...base.characters[0]!, identity: "" };
  let live: FilmProject | null = base;
  const host: PortraitIdentityHost = {
    current: () => live,
    valid: () => true,
    request: vi
      .fn<PortraitIdentityHost["request"]>()
      .mockResolvedValue({ text: " 青年男性\n 黑色短发 ", detail: "" }),
    apply: vi.fn((film: FilmProject) => {
      live = film;
    }),
    confirm: vi.fn<PortraitIdentityHost["confirm"]>().mockResolvedValue(),
    notice: vi.fn(),
    failed: vi.fn(),
  };
  return {
    base,
    host,
    id: base.characters[0]!.id,
    setLive: (film: FilmProject | null) => {
      live = film;
    },
  };
}

it("prepares missing identity from the script and delegates generation after applying", async () => {
  const { base, host, id, setLive } = setup();
  const pending = preparePortraitIdentity(base, id, host);
  setLive({ ...base, title: "用户新标题" });
  await pending;
  expect(host.request).toHaveBeenCalledWith(
    "writer",
    base.scenes
      .map((scene) => scene.text)
      .filter(Boolean)
      .join("\n"),
    expect.stringContaining(base.characters[0]!.name),
  );
  expect(host.current()?.title).toBe("用户新标题");
  expect(host.current()?.characters[0]?.identity).toBe("青年男性 黑色短发");
  expect(host.confirm).toHaveBeenCalledWith(id);
  expect(vi.mocked(host.apply).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(host.confirm).mock.invocationCallOrder[0]!,
  );
});

it("reuses an existing identity without requesting or rewriting it", async () => {
  const { base, host, id } = setup();
  base.characters[0]!.identity = "用户写的外貌";
  await preparePortraitIdentity(base, id, host);
  expect(host.request).not.toHaveBeenCalled();
  expect(host.apply).not.toHaveBeenCalled();
  expect(host.confirm).toHaveBeenCalledWith(id);
});

it.each(["", "性别未写明", "  \n  "])(
  "does not generate portraits for unresolved identity %j",
  async (text) => {
    const { base, host, id } = setup();
    host.request = vi.fn<PortraitIdentityHost["request"]>().mockResolvedValue({ text, detail: "" });
    await preparePortraitIdentity(base, id, host);
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.confirm).not.toHaveBeenCalled();
    expect(host.notice).toHaveBeenLastCalledWith("先写下外貌，再出定妆照。");
  },
);

it.each(["cancel", "project", "identity", "removed"])(
  "discards a late response after %s changes",
  async (change) => {
    const { base, host, id, setLive } = setup();
    const pending = preparePortraitIdentity(base, id, host);
    if (change === "cancel") host.valid = () => false;
    if (change === "project") setLive({ ...base, id: "other" });
    if (change === "identity")
      setLive({
        ...base,
        characters: base.characters.map((person) =>
          person.id === id ? { ...person, identity: "手改外貌" } : person,
        ),
      });
    if (change === "removed")
      setLive({ ...base, characters: base.characters.filter((person) => person.id !== id) });
    await pending;
    expect(host.apply).not.toHaveBeenCalled();
    expect(host.confirm).not.toHaveBeenCalled();
    expect(host.failed).not.toHaveBeenCalled();
    if (change === "identity") expect(host.current()?.characters[0]?.identity).toBe("手改外貌");
  },
);

it.each([true, false])("only reports failure for the current request (valid=%s)", async (valid) => {
  const { base, host, id } = setup();
  host.request = vi.fn<PortraitIdentityHost["request"]>().mockRejectedValue(new Error("failed"));
  const pending = preparePortraitIdentity(base, id, host);
  host.valid = () => valid;
  await pending;
  expect(host.failed).toHaveBeenCalledTimes(valid ? 1 : 0);
  expect(host.confirm).not.toHaveBeenCalled();
});

it("awaits portrait delegation and handles its failure", async () => {
  const { base, host, id } = setup();
  base.characters[0]!.identity = "成年男性";
  host.confirm = vi
    .fn<PortraitIdentityHost["confirm"]>()
    .mockRejectedValue(new Error("save failed"));
  await preparePortraitIdentity(base, id, host);
  expect(host.failed).toHaveBeenCalledOnce();
});
