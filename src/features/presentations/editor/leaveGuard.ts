import type { MouseEvent } from 'react'

/** true = the click may proceed; false = it must not change the route. */
export type LeaveGuard = (event: MouseEvent) => boolean | Promise<boolean>

let guard: LeaveGuard | null = null

/**
 * The one in-app navigation guard this app needs: the editor that is showing
 * unsaved work registers one while it is open, and clears it on unmount.
 * Registering replaces the current guard, so callers must clear on unmount.
 */
export function registerLeaveGuard(handler: LeaveGuard | null): void {
  guard = handler
}

/**
 * Whether a click has to be taken over synchronously to await a guard. A guard's
 * decision is async, so a link that consults it must prevent the default click
 * BEFORE awaiting: `preventDefault` after an await is already too late.
 */
export function hasLeaveGuard(): boolean {
  return guard !== null
}

/** Nothing registered means nothing can be lost, so the click proceeds. */
export async function invokeLeaveGuards(event: MouseEvent): Promise<boolean> {
  const current = guard
  if (!current) return true
  return await current(event)
}
