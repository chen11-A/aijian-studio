import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertNoDemoCropBytes,
  developmentCoreAssets,
  omittedCrop,
  readDemoCrops,
  readDevelopmentCoreArtwork,
} from "./developmentCoreAssets";

const temporary: string[] = [];
afterEach(() =>
  temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })),
);

describe("DEVELOPMENT_CORE demo-crop boundary", () => {
  it("verifies all fourteen source crops without changing fixture files", () => {
    const crops = readDemoCrops();
    expect(crops).toHaveLength(14);
    expect(crops.find((crop) => crop.name === "character")?.sha256).toBe(
      "cb627845058d88d948308f7abbcec839cccc358e73e3a0266a854aa3ad86e204",
    );
    expect(crops.some((crop) => crop.name === "street-wide")).toBe(true);
  });

  it("intercepts only exact manifest crop paths and only applies during a build", () => {
    const plugin = developmentCoreAssets();
    const crop = readDemoCrops()[0]!;
    expect(plugin.apply).toBe("build");
    expect(typeof plugin.resolveId).toBe("function");
    expect(typeof plugin.load).toBe("function");
    if (typeof plugin.resolveId !== "function" || typeof plugin.load !== "function")
      throw new Error("Expected function plugin hooks");
    const resolve = (source: string) =>
      Reflect.apply(plugin.resolveId as CallableFunction, null, [
        source,
        join(dirname(dirname(crop.path)), "data.ts"),
      ]);
    const id = resolve(`./assets/${crop.name}.jpg`);
    expect(id).toBe(`\0aivora-development-core-art:${crop.name}.jpg`);
    expect(resolve(`/src/aivora/assets/${crop.name}.jpg?url`)).toBe(id);
    expect(resolve(crop.path)).toBe(id);
    expect(resolve("./assets/v2/story-art.png")).toBe(
      "\0aivora-development-core-art:v2/story-art.png",
    );
    expect(resolve("./assets/v2/NotoSansCJKsc-Regular.otf")).toBeNull();
    expect(resolve("./user-owned/hero.jpg")).toBeNull();
    expect(Reflect.apply(plugin.load, null, [id])).toBe(
      `export default ${JSON.stringify(omittedCrop)};`,
    );
    expect(Reflect.apply(plugin.load, null, ["ordinary-module"])).toBeNull();
  });

  it("inventories unreviewed raster artwork separately, preserving fonts and SVG sources", () => {
    const items = readDevelopmentCoreArtwork();
    expect(items.filter((item) => item.category === "demo-crop")).toHaveLength(14);
    expect(
      items.some(
        (item) => item.name === "v2/story-art.png" && item.category === "unreviewed-raster",
      ),
    ).toBe(true);
    expect(items.some((item) => item.name === "world-reference.png")).toBe(true);
    expect(items.some((item) => /\.(otf|txt|svg)$/.test(item.path))).toBe(false);
    const v2 = items.find((item) => item.name === "v2/story-art.png")!;
    expect(() => assertNoDemoCropBytes(v2.bytes, items, "renamed.png")).toThrow("excluded artwork");
  });

  it("rejects copied crop bytes and small inlined base64 crops", () => {
    const crops = readDemoCrops();
    const crop = crops.find((item) => item.name === "street-wide")!;
    expect(() => assertNoDemoCropBytes(crop.bytes, crops, "renamed.jpg")).toThrow(
      "excluded artwork",
    );
    expect(() =>
      assertNoDemoCropBytes(
        `const url='data:image/jpeg;base64,${crop.bytes.toString("base64")}'`,
        crops,
        "main.js",
      ),
    ).toThrow("street-wide");
    expect(() => assertNoDemoCropBytes(omittedCrop, crops, "main.js")).not.toThrow();
  });

  it("fails closed on missing, empty, unverified, duplicate or changed manifest inputs", () => {
    const root = mkdtempSync(join(tmpdir(), "aivora-crop-boundary-"));
    temporary.push(root);
    const bytes = Buffer.from("isolated test-only crop content");
    const entry = {
      name: "sample",
      purpose: "Design-reference crop; demo only",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    const manifest = (value: unknown) =>
      writeFileSync(join(root, "manifest.json"), JSON.stringify(value));
    manifest([]);
    expect(() => readDemoCrops(root)).toThrow("must not be empty");
    manifest([null]);
    expect(() => readDemoCrops(root)).toThrow("Invalid");
    manifest([{ ...entry, name: "../sample" }]);
    expect(() => readDemoCrops(root)).toThrow("Unverified");
    manifest([{ ...entry, purpose: "unreviewed" }]);
    expect(() => readDemoCrops(root)).toThrow("Unverified");
    manifest([entry]);
    expect(() => readDemoCrops(root)).toThrow();
    writeFileSync(join(root, "sample.jpg"), bytes);
    expect(readDemoCrops(root)).toHaveLength(1);
    manifest([entry, entry]);
    expect(() => readDemoCrops(root)).toThrow("Unverified");
    manifest([entry]);
    writeFileSync(join(root, "sample.jpg"), "changed");
    expect(() => readDemoCrops(root)).toThrow("hash changed");
  });
});
