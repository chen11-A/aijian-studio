import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { WORKSPACE_SELECTION_STORAGE_KEY } from "../aivora/adapters/workspaceSelection";

afterEach(cleanup);
beforeEach(() => window.localStorage.removeItem(WORKSPACE_SELECTION_STORAGE_KEY));
