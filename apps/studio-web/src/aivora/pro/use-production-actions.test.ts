import { renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { sampleFilm } from "../film/project";
import { useProductionActions } from "./use-production-actions";
import type { AgentRequestControl } from "./workflow";

it("forwards the third deadline/cancellation argument through the stable hook", async () => {
  const film = sampleFilm();
  film.scenes[0]!.text = "门打开了。警笛响起。";
  film.shots = [];
  let control: AgentRequestControl | undefined;
  const host = {
    current: () => film,
    apply: vi.fn(),
    notify: vi.fn(),
    requestDirector: vi.fn(async (_c: string, _i: string, next?: AgentRequestControl) => {
      control = next;
      return {
        text: JSON.stringify({ shots: [{ picture: film.scenes[0]!.text, seconds: 3 }] }),
        detail: "",
      };
    }),
  };
  const { result, unmount } = renderHook(() => useProductionActions(host));
  await result.current.fixCoverage(film.scenes[0]!.id);
  expect(control?.deadlineAt).toBeGreaterThan(Date.now());
  expect(control?.signal).toBeInstanceOf(AbortSignal);
  expect(host.apply).toHaveBeenCalledOnce();
  unmount();
});
