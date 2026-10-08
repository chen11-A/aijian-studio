import { describe, expect, it } from "vitest";
import {
  textRequestHash,
  validateTextCommand,
  type ChatGPTTextCommand,
} from "./chatgpt-auth-generation";
const valid = {
  operationId: "11111111-1111-4111-8111-111111111111",
  model: "fixture",
  text: "one\ntwo",
};
const catalog = [{ slug: "fixture", displayName: "Fixture" }];
describe("generation command validation", () => {
  it("binds model/text/instructions to a stable non-secret digest", () => {
    expect(textRequestHash(valid)).toBe(textRequestHash({ ...valid, instructions: "" }));
    expect(textRequestHash(valid)).not.toBe(textRequestHash({ ...valid, text: "different" }));
    expect(() =>
      validateTextCommand(
        { ...valid, instructions: "some\ninstructions", approvalContext: "project / episode" },
        catalog,
      ),
    ).not.toThrow();
  });
  it.each([
    { ...valid, operationId: "bad" },
    { ...valid, model: "absent" },
    { ...valid, text: "" },
    { ...valid, text: "x".repeat(100001) },
    { ...valid, instructions: "" },
    { ...valid, approvalContext: "" },
  ])("rejects invalid input without inference", (input: ChatGPTTextCommand) => {
    expect(() => validateTextCommand(input, catalog)).toThrow("TEXT_REQUEST_INVALID");
  });
});
