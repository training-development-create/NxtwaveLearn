import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LDApp } from "@/components/ld/App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

createRoot(root).render(
  <StrictMode>
    <LDApp />
  </StrictMode>
);

