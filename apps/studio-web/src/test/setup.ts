import { webcrypto } from "node:crypto";
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { WORKSPACE_SELECTION_STORAGE_KEY } from "../aivora/adapters/workspaceSelection";

afterEach(cleanup);
beforeEach(() => window.localStorage.removeItem(WORKSPACE_SELECTION_STORAGE_KEY));

// Electron Chromium has WebCrypto; jsdom supplies crypto without subtle.
if (!globalThis.crypto.subtle)
  Object.defineProperty(globalThis.crypto, "subtle", {
    value: webcrypto.subtle,
    configurable: true,
  });
