/** App version from package.json, injected by Vite at build time. */
declare const __APP_VERSION__: string

/**
 * A short id of this build, injected by Vite (vite.config.ts): the first 7 characters of the
 * commit on the GitHub Pages workflow ("3f9c2ab"), else the UTC time the build ran
 * ("2026-10-19 14:05"; in development, when the dev server started).
 */
declare const __BUILD_ID__: string
