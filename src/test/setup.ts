import { transferableAbortController } from 'node:util'

/**
 * React Router's data router builds a Request for every navigation, and Undici's
 * Request accepts only Node's AbortSignal. Vitest's jsdom environment replaces
 * the global with jsdom's implementation, so restore Node's before any router
 * runs; otherwise every navigation rejects with a cross-realm signal error.
 */
const nativeAbort = transferableAbortController()
globalThis.AbortController = nativeAbort.constructor as unknown as typeof AbortController
globalThis.AbortSignal = nativeAbort.signal.constructor as unknown as typeof AbortSignal
