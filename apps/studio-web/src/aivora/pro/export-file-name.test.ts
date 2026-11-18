import { expect, it } from "vitest";
import {
  exportFileIssue,
  requestedExportFileName,
  writtenExportNames,
  writtenFileName,
} from "./export-file-name";

it("rejects an empty or illegal export name and echoes the file that was actually written", () => {
  expect(exportFileIssue("  ")).toBe("文件名还没写");
  expect(exportFileIssue("雨夜/巷战.mp4")).toBe("文件名里有不能用于文件的字符");
  expect(exportFileIssue("雨夜巷战-第1集.mp4")).toBe("");
  expect(writtenFileName("/published/雨夜巷战.mp4")).toBe("雨夜巷战.mp4");
  expect(writtenFileName("C:\\films\\成片.mp4")).toBe("成片.mp4");
  expect(writtenExportNames(["/out/雨夜-16x9.mp4", "C:\\out\\雨夜-9x16.mp4"])).toBe(
    "雨夜-16x9.mp4、雨夜-9x16.mp4",
  );
});

it("sends an export name only after the user changes it", () => {
  expect(requestedExportFileName(null, "雨夜巷战-第1集.mp4")).toBeUndefined();
  expect(requestedExportFileName("雨夜巷战-第1集.mp4", "雨夜巷战-第1集.mp4")).toBeUndefined();
  expect(requestedExportFileName("成片终稿", "雨夜巷战-第1集.mp4")).toBe("成片终稿");
});
