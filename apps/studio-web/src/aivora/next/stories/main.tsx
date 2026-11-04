// Entry for stories/index.html. Open it from the dev server, for example
// http://127.0.0.1:5173/src/aivora/next/stories/index.html?story=task-center
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { StoryGallery } from "./gallery";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <StoryGallery search={window.location.search} />
    </StrictMode>,
  );
}
