import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { bootstrapCatalog } from "./data/dynamic";

// Probe for a configured backend first: if the CMS is live, the whole
// site swaps hot-swaps to the published catalog before first paint.
// Otherwise the built-in demo dataset stays active.
void bootstrapCatalog().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>
  );
});
