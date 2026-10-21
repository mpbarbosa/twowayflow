import { createRoot } from "react-dom/client";
import { Canvas } from "./Canvas.jsx";
import "@xyflow/react/dist/style.css";
import "./canvas.css";

const container = document.getElementById("root");
if (!container) throw new Error("twowayflow: webview root element is missing");

createRoot(container).render(<Canvas />);
