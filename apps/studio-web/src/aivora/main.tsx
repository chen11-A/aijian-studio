import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DemoApp } from "./DemoApp";
import "./demo.css";
import "./authority.css";
import "./v2.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DemoApp />
  </StrictMode>,
);
