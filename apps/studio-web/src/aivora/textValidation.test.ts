import { describe, expect, it, vi } from "vitest";
import { prepareAppPreferencesSave } from "./adapters/appPreferences";
import type { AppPreferencesResponse } from "./adapters/appPreferences";
import { readProjectUpdateJournal, updateManagedProject } from "./adapters/projectManagement";
import { hasAsciiControlCharacter } from "./textValidation";

const unsaved: AppPreferencesResponse = {
  data: {
    saved: false,
    revision: 0,
    user_name: "",
    display_bio: "",
    ui_language: "zh-CN",
    ui_theme: "dark-cinematic",
    created_at: null,
    updated_at: null,
  },
  request_id: "validation-test",
};
const projectId = `prj_${"1".repeat(32)}`;
const intent = {
  projectId,
  operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  expectedRevision: 1,
  name: "作品",
  status: null,
};

describe("field-specific ASCII control validation", () => {
  it("checks every UTF-16 code unit without rejecting C1 controls or other Unicode", () => {
    const mismatches: string[] = [];
    for (let code = 0; code <= 0xffff; code += 1) {
      const character = String.fromCharCode(code);
      const forbidden = code < 32 || code === 127;
      for (const value of [character, `作品😀${character}尾`, `${character}作品😀`]) {
        if (
          hasAsciiControlCharacter(value) !== forbidden ||
          hasAsciiControlCharacter(value, true) !== (forbidden && code !== 10)
        ) {
          mismatches.push(code.toString(16));
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(hasAsciiControlCharacter("")).toBe(false);
    expect(hasAsciiControlCharacter("作品😀\n下一行", true)).toBe(false);
    expect(hasAsciiControlCharacter("作品\n\t下一行", true)).toBe(true);
  });

  it("keeps nickname controls rejected and allows only LF in a creative signature", () => {
    for (let code = 0; code <= 255; code += 1) {
      const value = `甲${String.fromCharCode(code)}乙`;
      const forbidden = code < 32 || code === 127;
      expect("kind" in prepareAppPreferencesSave(unsaved, value, ""), `nickname ${code}`).toBe(
        forbidden,
      );
      expect("kind" in prepareAppPreferencesSave(unsaved, "昵称", value), `signature ${code}`).toBe(
        forbidden && code !== 10,
      );
    }
    const normalized = prepareAppPreferencesSave(unsaved, " \t昵称\n ", "甲\r\n乙\r\n");
    expect(normalized).toMatchObject({ user_name: "昵称", display_bio: "甲\n乙\n" });
    expect(prepareAppPreferencesSave(unsaved, "昵称", "甲\r乙")).toHaveProperty(
      "kind",
      "INVALID_INPUT",
    );
  });

  it("preserves code-point length limits after trimming and CRLF normalization", () => {
    expect(
      prepareAppPreferencesSave(unsaved, "😀".repeat(80), "😀".repeat(1000)),
    ).not.toHaveProperty("kind");
    expect(prepareAppPreferencesSave(unsaved, "😀".repeat(81), "")).toHaveProperty(
      "kind",
      "INVALID_INPUT",
    );
    expect(prepareAppPreferencesSave(unsaved, "昵称", "😀".repeat(1001))).toHaveProperty(
      "kind",
      "INVALID_INPUT",
    );
    expect(prepareAppPreferencesSave(unsaved, " \t\n ", "")).toHaveProperty(
      "kind",
      "INVALID_INPUT",
    );
  });

  it("applies the same control boundary to persisted project names without trimming them", () => {
    for (let code = 0; code <= 255; code += 1) {
      const name = `甲${String.fromCharCode(code)}乙`;
      const storage = {
        getItem: () => JSON.stringify({ ...intent, name }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      };
      expect(readProjectUpdateJournal(storage, projectId).kind, `project name ${code}`).toBe(
        code < 32 || code === 127 ? "BLOCKED" : "PENDING",
      );
    }
    const storage = {
      getItem: () => JSON.stringify({ ...intent, name: " 作品 " }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(readProjectUpdateJournal(storage, projectId).kind).toBe("BLOCKED");
  });

  it("blocks every forbidden project-name control before storage or a PATCH", async () => {
    const gateway = { getProject: vi.fn(), updateProject: vi.fn() };
    const storage = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() };
    for (const code of [...Array.from({ length: 32 }, (_, index) => index), 127]) {
      const result = await updateManagedProject(gateway, storage, projectId, {
        expectedRevision: 1,
        name: `甲${String.fromCharCode(code)}乙`,
      });
      expect(result.kind, `project command ${code}`).toBe("UNAVAILABLE");
    }
    expect(gateway.updateProject).not.toHaveBeenCalled();
    expect(gateway.getProject).not.toHaveBeenCalled();
    expect(storage.getItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
