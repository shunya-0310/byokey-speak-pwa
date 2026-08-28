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
      registerType: "autoUpdate",
      injectRegister: null,
      includeAssets: ["icons/app-icon-192.png", "icons/app-icon-512.png", "images/splash_logo.webp"],
      manifest: {
        name: "BYOKey Speak",
        short_name: "BYOKey Speak",
        description: "Gemini APIキーで使う登録不要の英会話PWA体験版。A1〜A2の会話、コーチ設定、単語帳、学習進捗をブラウザ内で管理できます。",
        theme_color: "#101b2c",
        background_color: "#FEFEFE",
        lang: "ja",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/app-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
          { src: "/icons/app-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
        ],
        shortcuts: [
          { name: "New Chat", short_name: "New Chat", url: "/?action=new-chat" },
          { name: "Settings", short_name: "Settings", url: "/?tab=settings" }
        ]
      },
      workbox: {
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,webp,jpg,mp3,wav,json,webmanifest}"],
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
