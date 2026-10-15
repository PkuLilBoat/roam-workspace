/// <reference types="svelte" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
    readonly VITE_JOURNAL_STREAM_BUILD_HEAD: string;
    readonly VITE_JOURNAL_STREAM_BUILD_DIRTY: string;
    readonly VITE_JOURNAL_STREAM_SOURCE_STATE_HASH: string;
    readonly VITE_JOURNAL_STREAM_BUILD_ID: string;
    readonly VITE_JOURNAL_STREAM_BUILD_TIME: string;
    readonly VITE_JOURNAL_STREAM_MANIFEST_ID: string;
    readonly VITE_JOURNAL_STREAM_MANIFEST_VERSION: string;
}
