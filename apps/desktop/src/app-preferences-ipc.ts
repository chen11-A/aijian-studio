import {
  APP_PREFERENCES_CHANNELS,
  isSaveAppPreferencesCommand,
  type AppPreferencesReadResult,
  type AppPreferencesSaveResult,
  type SaveAppPreferencesCommand,
} from "./app-preferences-contract";

type AppPreferencesClient = {
  getAppPreferences(): Promise<AppPreferencesReadResult>;
  saveAppPreferences(command: SaveAppPreferencesCommand): Promise<AppPreferencesSaveResult>;
};

export function registerAppPreferencesHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => AppPreferencesClient,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): AppPreferencesClient => {
    const client = clientFor(event);
    if (!isTopLevelFrame(event)) {
      throw new Error("App preferences IPC sender frame is not authorized");
    }
    return client;
  };
  handle(APP_PREFERENCES_CHANNELS.get, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 0) throw new Error("App preferences read IPC takes no arguments");
    return client.getAppPreferences();
  });
  handle(APP_PREFERENCES_CHANNELS.save, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 1 || !isSaveAppPreferencesCommand(args[0])) {
      throw new Error("App preferences save IPC requires a canonical command");
    }
    return client.saveAppPreferences(args[0]);
  });
}
