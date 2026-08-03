import type { components } from "@aijian/contracts";
import { contextBridge, ipcRenderer } from "electron";

type HealthResponse = components["schemas"]["HealthResponse"];

contextBridge.exposeInMainWorld("aijian", {
  health: (): Promise<HealthResponse> =>
    ipcRenderer.invoke("health:get") as Promise<HealthResponse>,
});
