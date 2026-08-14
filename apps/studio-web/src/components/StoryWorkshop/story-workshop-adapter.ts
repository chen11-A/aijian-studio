import {
  mockPrepareG2Package,
  mockSaveDraft,
  mockVerifySources,
  type MockActionOptions,
  type MockActionResult,
  type StoryDisposition,
  type StoryDraft,
  type StoryWorkshopMachine,
  updateDraft,
  upsertDisposition,
} from "./story-workshop-model";

export interface StoryWorkshopAdapter {
  verifySources(
    machine: StoryWorkshopMachine,
    options?: MockActionOptions,
  ): Promise<MockActionResult>;
  saveDraft(
    machine: StoryWorkshopMachine,
    patch: Partial<StoryDraft>,
    options?: MockActionOptions,
  ): Promise<MockActionResult>;
  recordDisposition(
    machine: StoryWorkshopMachine,
    disposition: StoryDisposition,
  ): Promise<StoryWorkshopMachine>;
  prepareG2Package(
    machine: StoryWorkshopMachine,
    options?: MockActionOptions,
  ): Promise<MockActionResult>;
}

export function createMockStoryWorkshopAdapter(): StoryWorkshopAdapter {
  return {
    async verifySources(machine, options) {
      return mockVerifySources(machine, options);
    },
    async saveDraft(machine, patch, options) {
      return mockSaveDraft(updateDraft(machine, patch), options);
    },
    async recordDisposition(machine, disposition) {
      return upsertDisposition(machine, disposition);
    },
    async prepareG2Package(machine, options) {
      return mockPrepareG2Package(machine, options);
    },
  };
}
