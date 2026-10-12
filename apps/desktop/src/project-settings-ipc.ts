import {
  SETTINGS_CHANNELS,
  settingsProjectId,
  settingsOperationId,
  settingsCommand,
} from "@aijian/contracts/project-settings";
import type { ProjectSettingsGateway } from "@aijian/contracts/project-settings";
export function registerProjectSettingsHandlers<T>(
  handle: (channel: string, listener: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  clientFor: (event: T) => ProjectSettingsGateway,
  isTopFrame: (event: T) => boolean,
): void {
  const client = (event: T) => {
    if (!isTopFrame(event)) throw new Error("Project settings require authorized top frame");
    return clientFor(event);
  };
  handle(SETTINGS_CHANNELS.read, async (event, ...args) => {
    const api = client(event);
    if (args.length !== 1 || !settingsProjectId(args[0]))
      throw new Error("Invalid project settings scope");
    return api.getProjectSettings(args[0]);
  });
  handle(SETTINGS_CHANNELS.receipt, async (event, ...args) => {
    const api = client(event);
    if (args.length !== 2 || !settingsProjectId(args[0]) || !settingsOperationId(args[1]))
      throw new Error("Invalid project settings receipt scope");
    return api.getProjectSettingsReceipt(args[0], args[1]);
  });
  handle(SETTINGS_CHANNELS.write, async (event, ...args) => {
    const api = client(event);
    if (args.length !== 2 || !settingsProjectId(args[0]) || !settingsCommand(args[1]))
      throw new Error("Invalid project settings command");
    return api.updateProjectSettings(args[0], args[1]);
  });
}
