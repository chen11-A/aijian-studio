import type { createFilmRiskTrials } from "./film-risk-trial";
export function registerFilmRiskTrials<Event>(
  handle: (channel: string, run: (event: Event, ...args: unknown[]) => Promise<unknown>) => void,
  authorized: (event: Event) => boolean,
  owner: (event: Event) => number,
  trials: ReturnType<typeof createFilmRiskTrials>,
) {
  for (const channel of [
    "film:risk-trial-prepare",
    "film:risk-trial-media",
    "film:risk-trial-record",
    "film:risk-trial-check",
  ] as const) {
    handle(channel, async (event, ...args) => {
      if (!authorized(event)) throw Error("Unauthorized film risk trial sender");
      if (args.length !== (channel === "film:risk-trial-media" ? 2 : 1))
        throw Error("Invalid film risk trial arguments");
      if (channel === "film:risk-trial-prepare") return trials.prepare(owner(event), args[0]);
      if (channel === "film:risk-trial-record") return trials.record(owner(event), args[0]);
      if (channel === "film:risk-trial-check") return trials.check(owner(event), args[0]);
      if (typeof args[0] !== "string" || typeof args[1] !== "string")
        throw Error("Invalid film risk trial arguments");
      return trials.readMedia(owner(event), args[0], args[1]);
    });
  }
}
