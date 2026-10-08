import { expect, test, vi } from "vitest";
import {
  prepareAppPreferencesSave,
  readAppPreferences,
  saveAppPreferences,
} from "@qa-web/adapters/appPreferences.ts";

const empty = {
  data: { saved: false, revision: 0, user_name: "", display_bio: "",
    ui_language: "zh-CN", ui_theme: "dark-cinematic", created_at: null,
    updated_at: null },
  request_id: "request-0001",
};

function saved(revision, name, bio) {
  return {
    data: { saved: true, revision, user_name: name, display_bio: bio,
      ui_language: "zh-CN", ui_theme: "dark-cinematic",
      created_at: "2026-09-28T09:00:00+08:00",
      updated_at: "2026-09-28T09:00:01+08:00" },
    request_id: `request-${revision}`,
  };
}

test("P22 save uses current revision and confirms persistence by a fresh read", async () => {
  const reply = saved(1, "作者", "分行\n签名");
  const gateway = {
    saveAppPreferences: vi.fn(async () => ({ kind: "SAVED", receipt: reply })),
    getAppPreferences: vi.fn(async () => ({ kind: "FOUND", receipt: reply })),
  };
  const result = await saveAppPreferences(gateway, empty, " 作者 ", "分行\r\n签名");
  expect(result).toEqual({ kind: "SAVED", response: reply });
  expect(gateway.saveAppPreferences).toHaveBeenCalledWith({
    expected_revision: 0, user_name: "作者", display_bio: "分行\n签名",
    ui_language: "zh-CN", ui_theme: "dark-cinematic",
  });
  expect(gateway.saveAppPreferences).toHaveBeenCalledTimes(1);
  expect(gateway.getAppPreferences).toHaveBeenCalledTimes(1);
});

test("P22 keeps an unconfirmed save UNKNOWN and never submits again", async () => {
  const gateway = {
    saveAppPreferences: vi.fn(async () => ({ kind: "SAVED", receipt: saved(1, "作者", "签名") })),
    getAppPreferences: vi.fn(async () => ({ kind: "FOUND", receipt: empty })),
  };
  expect((await saveAppPreferences(gateway, empty, "作者", "签名")).kind).toBe("UNKNOWN");
  expect(gateway.saveAppPreferences).toHaveBeenCalledTimes(1);
  expect(gateway.getAppPreferences).toHaveBeenCalledTimes(1);
});

test("P22 blocks invalid or unverified input before any save", async () => {
  const gateway = { saveAppPreferences: vi.fn(), getAppPreferences: vi.fn() };
  expect(prepareAppPreferencesSave(empty, "  ", "").kind).toBe("INVALID_INPUT");
  expect((await saveAppPreferences(gateway, empty, "A\u0000B", "")).kind).toBe("INVALID_INPUT");
  expect((await readAppPreferences({ getAppPreferences: async () => ({
    kind: "FOUND", receipt: { ...empty, data: { ...empty.data, revision: 9 } },
  }) })).kind).toBe("ERROR");
  expect(gateway.saveAppPreferences).not.toHaveBeenCalled();
});
