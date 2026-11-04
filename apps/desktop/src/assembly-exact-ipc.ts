import {
  ASSEMBLY_EXACT_CHANNELS,
  assemblyExactCommand,
  type AssemblyExactGateway,
} from "@aijian/contracts/assembly-exact";
export function registerAssemblyExactHandlers<T>(
  handle: (channel: string, handler: (event: T, ...args: unknown[]) => Promise<unknown>) => void,
  clientFor: (event: T) => AssemblyExactGateway,
  top: (event: T) => boolean,
): void {
  for (const [kind, channel] of Object.entries(ASSEMBLY_EXACT_CHANNELS))
    handle(channel, async (event, ...args) => {
      const client = clientFor(event);
      if (!top(event)) throw new Error("Unauthorized original assembly frame");
      if (
        args.length !== 3 ||
        typeof args[0] !== "string" ||
        typeof args[1] !== "string" ||
        !assemblyExactCommand(args[2], args[0], args[1])
      )
        throw new Error("Invalid original assembly IPC arguments");
      return kind === "save"
        ? client.saveExact(args[0], args[1], args[2])
        : client.getOriginal(args[0], args[1], args[2]);
    });
}
