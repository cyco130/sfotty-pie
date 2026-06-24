/// <reference types="vite/client" />

interface ImportMetaEnv {
	/** Short commit hash of the build (`-dirty` if the tree had changes). */
	readonly GIT_HASH: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
