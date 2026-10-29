import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ComputerUseOverlay } from "./components/ComputerUseOverlay";
import "./index.css";

const overlay = window.location.hash === "#computer-use-overlay";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {overlay ? <ComputerUseOverlay /> : <App />}
  </React.StrictMode>,
);
