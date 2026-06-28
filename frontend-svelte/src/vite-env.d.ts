/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_WS_LOGS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
