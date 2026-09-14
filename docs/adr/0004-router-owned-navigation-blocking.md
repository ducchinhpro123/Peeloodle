# Block navigation at the router, own editor sessions explicitly

Accepted and implemented. The app now renders a data router (`createBrowserRouter(createAppRoutes())` in `src/app/routes.tsx`), and the presentation editor blocks leaving through `useBlocker` in `editor/useLeaveBlock.ts`. The earlier `leaveGuard.ts`/`GuardedLink` registry is deleted, and the app shell, routes and page components moved out of `src/main.tsx` into `src/app/` and their features.

A link-scoped guard could only stop the links that consulted it: the browser Back/Forward buttons and programmatic `navigate()` bypassed it, and closing that gap required a data router rather than a patch. With one `useBlocker` over the dirty document, links, `navigate()` and history POP all save first and proceed only after a successful write; `beforeunload` in `usePresentationSave` still covers reload and tab close. Tests that mount the app now use `createMemoryRouter(createAppRoutes(...))`, matching the production seam.

The same "explicit owner" rule applies to text editing: `createTextEditSession()` is owned by the editor page and passed through `TextEditSessionProvider`, so the DOM overlay registers its flush and formatting controller for the life of that session instead of in module-level globals. `presentationSaving.ts` holds the single-writer save rules behind `usePresentationSave`, mirroring `draftSaving.ts` for stickers.

See [architecture](../slides-architecture.md) and [handoff](../../HANDOFF.md).
