/**
 * The warm-up list itself, checked without running the imports it holds: calling a
 * loader here would import the real route and export modules under jsdom, which is
 * slow and cannot say anything about the browser chunks. The production spec is where
 * those fetches are observed.
 */

import { describe, expect, it } from 'vitest'
import { EXPORT_BUILDER_LOADERS } from './exports/loaders'
import { PRESENTATION_OFFLINE_MODULES } from './offlineModules'

describe('PRESENTATION_OFFLINE_MODULES', () => {
  it('holds the three presentation routes the flow renders', () => {
    // Library, editor and the editor's lazy canvas: rendering a route does not fetch
    // a lazy child, so the canvas is its own entry.
    expect(PRESENTATION_OFFLINE_MODULES).toHaveLength(3 + EXPORT_BUILDER_LOADERS.length)
  })

  it('warms the same loader objects the export controller calls', () => {
    // Identity, not equal shape: a builder is only warm if readiness awaited the very
    // loader `usePresentationExport` reaches, so a new format added to the shared list
    // is warmed without editing readiness.
    expect(PRESENTATION_OFFLINE_MODULES.slice(-EXPORT_BUILDER_LOADERS.length)).toEqual([...EXPORT_BUILDER_LOADERS])
  })
})
