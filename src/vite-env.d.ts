/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AI_PROVIDER?: "local" | "claude";
  readonly VITE_AI_API_BASE?: string;
  readonly VITE_LOCAL_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
