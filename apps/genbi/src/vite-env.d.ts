/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the live BFF. Unset (the default) keeps the app fixture-driven. */
  readonly VITE_BFF_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
