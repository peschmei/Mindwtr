/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_ANALYTICS_HEARTBEAT_URL?: string;
    readonly VITE_DISABLE_HEARTBEAT?: string;
    readonly VITE_DROPBOX_APP_KEY?: string;
    readonly VITE_FEEDBACK_ENDPOINT_URL?: string;
}

interface ImportMeta {
    readonly env: ImportMetaEnv;
}
