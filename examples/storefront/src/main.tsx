import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// The components' stylesheet. It is precompiled and scoped under `.kaiten`, so it cannot
// restyle anything else on the page.
import "@kaitencloud/react-ui/styles.css";
import "./styles.css";

import { App } from "./app.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
