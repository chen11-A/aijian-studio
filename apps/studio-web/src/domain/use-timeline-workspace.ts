import { useEffect, useRef, useState } from "react";
import {
  TimelineWorkspaceController,
  type TimelineWorkspaceGateway,
  type TimelineWorkspaceState,
} from "./timeline-workspace-controller";

type Slot = Readonly<{
  gateway: TimelineWorkspaceGateway;
  controller: TimelineWorkspaceController;
}>;
export function useTimelineWorkspace(
  gateway: TimelineWorkspaceGateway,
  projectId: string,
): readonly [TimelineWorkspaceController, TimelineWorkspaceState] {
  const slot = useRef<Slot | null>(null);
  if (slot.current === null || slot.current.gateway !== gateway) {
    slot.current?.controller.dispose();
    slot.current = {
      gateway,
      controller: new TimelineWorkspaceController(gateway, projectId),
    };
  }
  const controller = slot.current.controller;
  const [state, setState] = useState<TimelineWorkspaceState>(controller.getState());
  useEffect(() => controller.subscribe(setState), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  useEffect(() => {
    controller.setProject(projectId);
    // An absent desktop project is an honest empty UI state.  Do not turn it
    // into a request with an empty path segment.
    if (projectId) void controller.reload();
  }, [controller, projectId]);
  return [controller, state];
}
