import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MOTION } from "./config";
import "./index.css";

// Tag the root synchronously so CSS motion-scaling is in place before
// the first paint (no flash of animation in gentle mode).
document.documentElement.dataset.motion = MOTION;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
