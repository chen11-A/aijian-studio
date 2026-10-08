import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp";
import { WorkbenchRenderBoundary } from "./WorkbenchRenderBoundary";
import "./demo.css";
import "./authority.css";
import "./v2.css";
import "./workbench-layout.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkbenchRenderBoundary onReload={() => window.location.reload()}>
      <DemoApp />
    </WorkbenchRenderBoundary>
  </StrictMode>,
);
