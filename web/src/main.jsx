import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";

const container = document.getElementById("app");
if (container) createRoot(container).render(<App />);
