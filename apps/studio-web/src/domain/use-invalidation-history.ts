import { useEffect, useRef, useState } from "react";
import {
  InvalidationHistoryController,
  type InvalidationHistoryGateway,
  type InvalidationHistoryState,
} from "./invalidation-history-controller";

type ControllerSlot = Readonly<{
  gateway: InvalidationHistoryGateway;
  controller: InvalidationHistoryController;
}>;

export function useInvalidationHistory(
  gateway: InvalidationHistoryGateway,
  projectId: string,
): readonly [InvalidationHistoryController, InvalidationHistoryState] {
  const slot = useRef<ControllerSlot | null>(null);
  if (slot.current === null || slot.current.gateway !== gateway) {
    slot.current?.controller.dispose();
    slot.current = {
      gateway,
      controller: new InvalidationHistoryController(gateway, projectId),
    };
  }
  const controller = slot.current.controller;
  const [state, setState] = useState<InvalidationHistoryState>(controller.getState());

  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    controller.setProject(projectId);
    if (projectId) void controller.loadInitial();
  }, [controller, projectId]);

  return [controller, state];
}
