import type { ShotPlanGateway } from "@aijian/contracts/shot-plan";
import {
  SHOT_PLAN_CHANNELS,
  isHumanShotPlanRequest,
  isShotPlanAdoptionRequest,
  isShotPlanEpisodeId,
  isShotPlanOperationId,
  isShotPlanProjectId,
  isShotPlanVersionId,
} from "./shot-plan-contract";

export function registerShotPlanHandlers<TEvent>(
  handle: (
    channel: string,
    listener: (event: TEvent, ...args: unknown[]) => Promise<unknown>,
  ) => void,
  clientFor: (event: TEvent) => ShotPlanGateway,
  isTopLevelFrame: (event: TEvent) => boolean,
): void {
  const authorized = (event: TEvent): ShotPlanGateway => {
    if (!isTopLevelFrame(event)) throw new Error("Shot plan sender frame is not authorized");
    return clientFor(event);
  };
  const scope = (args: unknown[]): args is [string, string, ...unknown[]] =>
    isShotPlanProjectId(args[0]) && isShotPlanEpisodeId(args[1]);
  handle(SHOT_PLAN_CHANNELS.prepare, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !scope(args))
      throw new Error("Shot plan preparation requires canonical scope ids");
    return client.prepareHumanShotPlan(args[0], args[1]);
  });
  handle(SHOT_PLAN_CHANNELS.latest, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 2 || !scope(args))
      throw new Error("Shot plan latest requires canonical scope ids");
    return client.getShotPlanProposal(args[0], args[1]);
  });
  handle(SHOT_PLAN_CHANNELS.version, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args) || !isShotPlanVersionId(args[2]))
      throw new Error("Shot plan version requires canonical ids");
    return client.getShotPlanProposalVersion(args[0], args[1], args[2]);
  });
  handle(SHOT_PLAN_CHANNELS.writeStatus, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args) || !isShotPlanOperationId(args[2]))
      throw new Error("Shot plan write status requires a canonical UUID v4");
    return client.getHumanShotPlanWriteStatus(args[0], args[1], args[2]);
  });
  handle(SHOT_PLAN_CHANNELS.adoptionStatus, async (event, ...args) => {
    const client = authorized(event);
    if (args.length !== 3 || !scope(args) || !isShotPlanVersionId(args[2]))
      throw new Error("Shot plan adoption status requires canonical ids");
    return client.getShotPlanAdoptionStatus(args[0], args[1], args[2]);
  });
  handle(SHOT_PLAN_CHANNELS.create, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 4 ||
      !scope(args) ||
      !isShotPlanOperationId(args[2]) ||
      !isHumanShotPlanRequest(args[3], args[0], args[1])
    )
      throw new Error("Human shot plan create requires canonical closed arguments");
    return client.createHumanShotPlanProposal(args[0], args[1], args[2], args[3]);
  });
  handle(SHOT_PLAN_CHANNELS.adopt, async (event, ...args) => {
    const client = authorized(event);
    if (
      args.length !== 5 ||
      !scope(args) ||
      !isShotPlanVersionId(args[2]) ||
      !isShotPlanOperationId(args[3]) ||
      !isShotPlanAdoptionRequest(args[4])
    )
      throw new Error("Human shot plan adopt requires explicit true confirmation");
    return client.adoptHumanShotPlanProposal(args[0], args[1], args[2], args[3], args[4]);
  });
}
