/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** id сборки (vite.config.ts → define); в dev и тестах — "dev" */
declare const __BUILD_ID__: string;
