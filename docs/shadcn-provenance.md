# shadcn/ui provenance

`src/components/ui.tsx` adapts the official shadcn/ui new-york-v4 Button, Card, Dialog, Tabs, and Slider sources at revision `c257f688cf4de7ec10cc1be84cad29cd4631182c`:

- https://raw.githubusercontent.com/shadcn-ui/ui/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/button.tsx
- https://raw.githubusercontent.com/shadcn-ui/ui/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/card.tsx
- https://raw.githubusercontent.com/shadcn-ui/ui/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/dialog.tsx
- https://raw.githubusercontent.com/shadcn-ui/ui/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/tabs.tsx
- https://raw.githubusercontent.com/shadcn-ui/ui/c257f688cf4de7ec10cc1be84cad29cd4631182c/apps/v4/registry/new-york-v4/ui/slider.tsx

The upstream code is MIT licensed: https://github.com/shadcn-ui/ui/blob/c257f688cf4de7ec10cc1be84cad29cd4631182c/LICENSE.md. The local adaptation keeps the upstream Radix composition, slots, and slider-thumb rendering while using the installed `@radix-ui/react-*` packages and centralized mint CSS instead of the upstream `radix-ui` aggregate and utility classes. Sheet uses the same upstream Dialog composition.
