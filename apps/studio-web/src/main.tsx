import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import AivoraUiDemo from "./aivora-ui-demo";

const root = document.getElementById("root");

if (!root) {
  throw new Error("AIVORA Studio root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <AivoraUiDemo />
  </StrictMode>,
);
