import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import {
  dispatchProtectedGenerationStill,
  GenerationStillDispatchError,
  type ProtectedStillDispatch,
} from "./film-generation-still-dispatch";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2ioAAAAASUVORK5CYII=",
  "base64",
);
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "protected-still-dispatch-"));
  roots.push(root);
  let live = true;
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify({ data: [{ b64_json: image.toString("base64") }] }), {
        status: 200,
      }),
  );
  const options: ProtectedStillDispatch = {
    prompt: "人物站在门口。",
    aspectRatio: "16:9",
    token: "native-only",
    destination: join(root, "frame.png"),
    fetcher,
    current: () => live,
    beforePost: vi.fn(async (_wire, dispatch) => dispatch()),
    notSent: vi.fn(async () => undefined),
    observed: vi.fn(async () => undefined),
  };
  return {
    options,
    fetcher,
    stop: () => {
      live = false;
    },
  };
}
it("uses the production serializer and real file write, then observes only the actual native output", async () => {
  const f = await setup();
  const result = await dispatchProtectedGenerationStill(f.options);
  expect(result.path).toBe(f.options.destination);
  expect(await readFile(result.path)).toEqual(image);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(f.fetcher.mock.calls[0]![1]!.body))).toMatchObject({
    prompt: f.options.prompt,
    model: "grok-imagine-image-2.0",
    aspect_ratio: "16:9",
  });
  expect(f.options.observed).toHaveBeenCalledExactlyOnceWith(result.path, {
    transportUnconfirmed: false,
  });
  expect(f.options.notSent).not.toHaveBeenCalled();
});
it("retirement during a held reservation reaches no actual provider transport", async () => {
  const f = await setup();
  let release!: () => void, admitted!: () => void;
  const entered = new Promise<void>((r) => {
      admitted = r;
    }),
    held = new Promise<void>((r) => {
      release = r;
    });
  f.options.beforePost = async (_wire, dispatch) => {
    admitted();
    await held;
    return dispatch();
  };
  const pending = dispatchProtectedGenerationStill(f.options);
  await entered;
  f.stop();
  release();
  expect(await pending).toMatchObject({ path: "", code: "EXECUTION_UNAVAILABLE" });
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.options.notSent).toHaveBeenCalledTimes(1);
  expect(f.options.observed).not.toHaveBeenCalled();
});
it("preserves a written image when durable observation acknowledgement is unknown", async () => {
  const f = await setup();
  f.options.observed = vi.fn(async () => {
    throw Error("PRIVATE");
  });
  const result = await dispatchProtectedGenerationStill(f.options);
  expect(result).toMatchObject({ path: f.options.destination, code: "WRITE_UNCONFIRMED" });
  expect(await readFile(result.path)).toEqual(image);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.options.notSent).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
});
it("network uncertainty is never treated as a proven-unsent reservation or automatically retried", async () => {
  const f = await setup();
  f.fetcher.mockRejectedValueOnce(Error("PRIVATE"));
  expect(await dispatchProtectedGenerationStill(f.options)).toMatchObject({
    path: "",
    code: "WRITE_UNCONFIRMED",
  });
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.options.notSent).not.toHaveBeenCalled();
  expect(f.options.observed).toHaveBeenCalledExactlyOnceWith(null, {
    transportUnconfirmed: true,
    outputUnconfirmed: true,
  });
});
it("keeps a fixed native policy rejection separate from raw provider or transport text", async () => {
  const f = await setup();
  f.options.beforePost = async () => {
    throw new GenerationStillDispatchError("CREATION_UNCONFIGURED");
  };
  expect(await dispatchProtectedGenerationStill(f.options)).toMatchObject({
    path: "",
    code: "CREATION_UNCONFIGURED",
  });
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(f.options.notSent).toHaveBeenCalledTimes(1);
});

it.each(["rejected", "http", "bytes"] as const)(
  "observes a dispatched image when its actual download is %s",
  async (mode) => {
    const f = await setup();
    f.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ data: [{ url: "https://example.invalid/frame.png" }] })),
    );
    if (mode === "rejected") f.fetcher.mockRejectedValueOnce(Error("PRIVATE download"));
    else if (mode === "http") f.fetcher.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else {
      const response = new Response(image);
      Object.defineProperty(response, "arrayBuffer", {
        value: async () => {
          throw Error("PRIVATE bytes");
        },
      });
      f.fetcher.mockResolvedValueOnce(response);
    }
    const result = await dispatchProtectedGenerationStill(f.options);
    expect(result).toMatchObject({ path: "", code: "WRITE_UNCONFIRMED" });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    expect(f.options.notSent).not.toHaveBeenCalled();
    expect(f.options.observed).toHaveBeenCalledExactlyOnceWith(null, {
      transportUnconfirmed: mode === "rejected",
      outputUnconfirmed: true,
    });
  },
);
it("observes dispatch after a real file write failure and preserves existing destination data", async () => {
  const f = await setup();
  await mkdir(f.options.destination);
  const sentinel = join(f.options.destination, "keep.bin");
  await writeFile(sentinel, image);
  const result = await dispatchProtectedGenerationStill(f.options);
  expect(result).toMatchObject({ path: "", code: "WRITE_UNCONFIRMED" });
  expect(await readFile(sentinel)).toEqual(image);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect(f.options.notSent).not.toHaveBeenCalled();
  expect(f.options.observed).toHaveBeenCalledExactlyOnceWith(null, {
    transportUnconfirmed: false,
    outputUnconfirmed: true,
  });
});

it.each([503, 200])(
  "keeps a sent response without proven output UNKNOWN and branded, without protected retries (status=%s)",
  async (status) => {
    const f = await setup();
    f.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] }), { status }));
    expect(await dispatchProtectedGenerationStill(f.options)).toMatchObject({
      path: "",
      code: "WRITE_UNCONFIRMED",
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(f.options.notSent).not.toHaveBeenCalled();
    expect(f.options.observed).toHaveBeenCalledExactlyOnceWith(null, {
      transportUnconfirmed: false,
      outputUnconfirmed: true,
    });
  },
);
