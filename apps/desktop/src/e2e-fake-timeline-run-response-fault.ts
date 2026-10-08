type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

const FAKE_TIMELINE_RUN_PATH = /^\/api\/v1\/projects\/prj_[0-9a-f]{32}\/fake-timeline-runs$/;

interface FakeTimelineRunResponseFaultOptions {
  isPackaged: boolean;
  hasIsolatedUserDataProfile: boolean;
  mode: string | undefined;
}

export function shouldEnableE2EFakeTimelineRunResponseFault(
  options: FakeTimelineRunResponseFaultOptions,
): boolean {
  return (
    !options.isPackaged && options.hasIsolatedUserDataProfile && options.mode === "after-201-once"
  );
}

function isFreshFakeTimelineRunResponse(
  input: string,
  init: RequestInit | undefined,
  response: Response,
): boolean {
  if (init?.method !== "POST" || response.status !== 201) return false;
  try {
    const url = new URL(input);
    return (
      url.protocol === "http:" &&
      url.hostname === "127.0.0.1" &&
      url.port.length > 0 &&
      FAKE_TIMELINE_RUN_PATH.test(url.pathname) &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export function createE2EFakeTimelineRunResponseFault(fetcher: Fetcher, enabled: boolean): Fetcher {
  let armed = enabled;
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (armed && isFreshFakeTimelineRunResponse(input, init, response)) {
      armed = false;
      throw new TypeError("simulated response loss after fake timeline run create");
    }
    return response;
  };
}
