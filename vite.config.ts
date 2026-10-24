import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Claude APIモードのとき、/api はローカルの中継サーバー（npm run dev:server）へ流す
    proxy: { "/api": "http://localhost:8787" },
  },
  optimizeDeps: { exclude: ["@huggingface/transformers"] },
  test: { environment: "node" },
});
