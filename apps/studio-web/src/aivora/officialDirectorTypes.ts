import type { OfficialDirectorBridge } from "@aijian/contracts/official-director";
import type { ShotPlanGateway, ShotPlanPreparation } from "@aijian/contracts/shot-plan";
import type { DirectorStorage } from "./adapters/officialDirectorJournal";

export type OfficialDirectorPanelProps = {
  projectId: string;
  episodeId: string;
  bridge: OfficialDirectorBridge | null;
  preparationGateway: ShotPlanGateway | null;
  scriptDirty: boolean;
  storyboardDirty: boolean;
  pendingOperations: boolean;
  currentStoryboardBase?: ShotPlanPreparation["storyboard_base"];
  onAdopted: () => void | Promise<void>;
  onWorkStateChange?: (state: {
    dirty: boolean;
    pending: boolean;
    busy: boolean;
    storyboardPending: boolean;
  }) => void;
  storage?: DirectorStorage | null;
};
