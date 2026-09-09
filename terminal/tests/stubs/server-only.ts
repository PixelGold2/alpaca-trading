// Vitest runs outside Next.js's RSC bundler condition, where the real
// "server-only" package throws unconditionally. Tests only import server
// code directly (never through a client bundle), so this is a safe no-op.
export {};
