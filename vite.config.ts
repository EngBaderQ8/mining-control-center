import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer build. Root is wired up in Milestone 8 when the React entry exists.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
