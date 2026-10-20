/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The studio web builds to static files in dist/ (D5); the supervisor serves them
// from its own origin under /app/ (Story 30.2), so asset URLs are absolute under that
// base: a deep path (/app/a/b) or /app without its slash still loads /app/assets/….
// A <base href="/app/"> prepended to <head> makes runtime-relative URLs (the sprite
// sheet atlas "sprites/office.json") resolve under /app/ too, from /app and deep paths.
const baseHref = (): Plugin => ({
  name: "studio-web-base-href",
  transformIndexHtml: () => [{ tag: "base", attrs: { href: "/app/" }, injectTo: "head-prepend" }],
});

export default defineConfig({
  base: "/app/",
  plugins: [react(), baseHref()],
  build: { outDir: "dist", emptyOutDir: true },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
