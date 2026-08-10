import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { execSync } from "node:child_process";

function gitValue(command: string, fallback: string) {
  try {
    return execSync(command, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback;
  } catch {
    return fallback;
  }
}

const commitSha = gitValue("git rev-parse --short=12 HEAD", "local-uncommitted");
const buildTime = new Date().toISOString();

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "prompt",
      injectRegister: "auto",
      includeAssets: ["icons/icon-192.png", "icons/icon-512.png", "images/splash_logo.webp"],
      manifest: {
        name: "BYOKey Speak",
        short_name: "BYOKey Speak",
        description: "Gemini APIキーを自分のブラウザから使う、登録不要の英会話PWA。",
        theme_color: "#101b2c",
        background_color: "#101b2c",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
        ],
        shortcuts: [
          { name: "New Chat", short_name: "New Chat", url: "/?action=new-chat", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
          { name: "Settings", short_name: "Settings", url: "/?tab=settings", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }
        ]
      },
      workbox: {
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,webp,jpg,mp3,json,webmanifest}"],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === "https://generativelanguage.googleapis.com",
            handler: "NetworkOnly",
            options: { cacheName: "gemini-never-cache" }
          },
          {
            urlPattern: ({ request, url }) => request.destination === "document" || url.pathname.startsWith("/data/"),
            handler: "NetworkFirst",
            options: { cacheName: "byokey-static-runtime" }
          }
        ]
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
    __COMMIT_SHA__: JSON.stringify(commitSha),
    __BUILD_TIME__: JSON.stringify(buildTime)
  },
  build: {
    sourcemap: false
  }
});
