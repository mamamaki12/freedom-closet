import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Claude APIモードのとき、/api はローカルの中継サーバー（npm run dev:server）へ流す
    // （中継サーバーは初期値で 127.0.0.1 だけで待つので、localhost ではなく 127.0.0.1 を指す）
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  test: { environment: "node" },
});
