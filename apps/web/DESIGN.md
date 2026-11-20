# WATeamInbox design system

The visual contract for `apps/web`. Read this before changing any UI. The rules
in **Hard rules** are enforced by `src/styles/design-system.test.ts`, which runs
in CI with the rest of the web unit tests.

## Principles

WATeamInbox should feel **premium, enterprise and minimal**. It is a tool that
people keep open all day, so it should feel calm.

1. **Monochrome first.** Neutral surfaces, hairline borders and a near-black
   (or near-white) primary action. Colour is information, not decoration.
2. **One accent with a job.** The brand green (`accent`) means *live, connected,
   success or brand link*. Don't use it for decoration, large fills or glows.
3. **Show exceptions only.** Status colours (`warning`, `danger`, `info`)
   appear only when something needs attention. Healthy rows stay quiet.
4. **Depth is restrained.** Use borders before shadows, and only the four
   elevation steps. No tinted or coloured shadows.
5. **Notes look private.** Internal notes always use the `note` tokens, so they
   can never be mistaken for customer-visible messages.
6. **Every theme is complete.** A component that looks right in one theme must
   look right in all of them, with no theme-specific code.

## Architecture

```text
src/styles/themes.css    raw values: one [data-theme="<id>"] block per theme
src/styles/tokens.css    semantic names -> Tailwind utilities (@theme inline)
src/lib/theme/themes.ts  registry: id, light/dark appearance, browser colour
index.html               pre-paint script (no flash): mirrors the registry
contexts/theme-context   preference (system | theme id) -> applies the theme
```

`<html>` carries `data-theme="<id>"`, plus the `dark` class when the theme's
appearance is dark. Components only use semantic utilities (`bg-surface`,
`text-fg-muted`, `border-line`). Each utility resolves to the active theme's
CSS variable, so changing the theme repaints everything without React
re-rendering.

`dark:` still exists for **non-colour** differences between light and dark
appearances (for example swapping an illustration). It must never set a colour.
The theme owns colour.

### Themes

| id         | Appearance | Character |
| ---------- | ---------- | --------- |
| `light`    | light      | Default. Warm-neutral greys, near-black primary, green accent. |
| `dark`     | dark       | True neutral dark. Near-black canvas, near-white primary. |
| `whatsapp` | dark       | The original WhatsApp Web-style dark palette (teal greys, `#00a884` primary, doodle canvas). |

The user's preference is `system` (follows the OS between `light` and `dark`)
or an explicit theme id. It is stored in `localStorage["wateaminbox-theme"]`.

### Adding a theme

1. Copy a block in `src/styles/themes.css` to `[data-theme="<id>"]` and change
   the values. **Every variable must be defined.**
2. Add the id to `THEMES` in `src/lib/theme/themes.ts`, with `appearance` and
   `metaColor`. `metaColor` must equal the theme's `--canvas`.
3. Add the same entry to the `THEMES` object in the `index.html` pre-paint
   script.
4. Add `settings.themePanel.<id>` and `<id>Label` to every locale file.
5. Run `bun test src/styles/design-system.test.ts`. It fails if any of steps
   1–3 are incomplete.

Nothing else changes: the theme picker, the menu and every component pick the
theme up automatically.

## Tokens

All tokens accept Tailwind opacity modifiers (`bg-accent/10`). In code, use
them as `bg-*`, `text-*`, `border-*`, `ring-*`, `fill-*` or `stroke-*`.

### Surfaces (back to front)

| Token | Use |
| ----- | --- |
| `canvas` | App background behind everything. |
| `surface` | Cards, panels, lists, sheets: the default container. |
| `subtle` | Quiet bands inside a surface: table headers, footers, read-only fields, hover on surface rows. |
| `muted` | Chips, segmented controls, secondary buttons, skeletons, hover on interactive items. |
| `muted-strong` | Pressed/hover state of `muted`, progress tracks. |
| `selected` | The currently open row in a list (conversation, group). |
| `field` | Input, select and textarea backgrounds. |
| `overlay` | Popovers, menus, dialogs, toasts: anything floating. |
| `scrim` | Backdrop behind modals and sheets. |

### Lines

| Token | Use |
| ----- | --- |
| `line` | Default hairline: dividers, card borders. |
| `line-strong` | Inputs, outline buttons, dashed drop zones, emphasised separators. |

### Text

| Token | Use |
| ----- | --- |
| `fg` | Primary text and icons. |
| `fg-muted` | Secondary text: descriptions, metadata, inactive tabs. |
| `fg-subtle` | Tertiary: placeholders, timestamps, disabled, decorative icons. |

### Actions and status

| Token | Use |
| ----- | --- |
| `primary` / `primary-hover` / `on-primary` | The main call to action. One per view. Near-black in `light`, near-white in `dark`, teal in `whatsapp`. |
| `ring` | Focus ring colour (`ring-ring/40`). |
| `accent` / `accent-hover` / `accent-soft` / `on-accent` | Brand green: live, connected, success, brand links, unread emphasis. |
| `success`, `success-soft` | Completed or positive state. |
| `warning`, `warning-soft` | At risk: SLA about to breach, needs review. |
| `danger`, `danger-hover`, `danger-soft`, `on-danger` | Errors, failed delivery, destructive actions, overdue. |
| `info`, `info-soft` | Neutral information, links inside content, read receipts. |

Soft variants are for backgrounds of badges, banners and icon tiles. Pair them
with the solid token as text: `bg-warning-soft text-warning`.

### Navigation rail

The app rail and the auth/onboarding side panel are always dark: they anchor
the layout in every theme. Use only `nav`, `nav-fg`, `nav-fg-muted`,
`nav-hover`, `nav-active`, `nav-active-fg`, `nav-badge` and `on-nav-badge`
there, never surface tokens.

### Conversation

| Token | Use |
| ----- | --- |
| `chat` | Message canvas fill. The theme decides the doodle texture via `--chat-pattern` and `--chat-pattern-opacity`; use `ConversationCanvasPattern`. |
| `bubble-in`, `bubble-out`, `bubble-fg` | Message bubbles. Use the constants in `MessageBubble.tsx`. |
| `note`, `note-fg`, `note-line` | Internal notes, private by design. |
| `highlight` | Search hit and jump-to-message highlight. |

### Identity

`id-1` … `id-7`, each with an `id-N-soft` partner, distinguish **people and
accounts** (avatar fallbacks, sender names, connection chips, categorical
icons). Choose an index by hashing a stable id. They never carry status
meaning; use status tokens for that.

### Charts

`chart-1` … `chart-4` are ordered series colours; `chart-grid` is for axes and
gridlines. In SVG, use `stroke="var(--chart-1)"`. In classes, use
`stroke-chart-1`.

### Brand marks

`brand-whatsapp`, `brand-whatsapp-business`, `brand-telegram`,
`brand-messenger`, `brand-line` and `brand-instagram-1..3` are constant across
themes. Use them **only** for third-party logos and channel tiles, never for UI
chrome.

### Elevation

| Utility | Use |
| ------- | --- |
| `shadow-xs` | Inputs, buttons, resting cards. |
| `shadow-sm` | Raised cards, chips over content. |
| `shadow-md` | Hover lift, tooltips, small popovers. |
| `shadow-lg` | Menus, popovers, dialogs, sheets. |
| `shadow-bubble` | Message bubbles (theme-controlled). |

### Radius

| Utility | Use |
| ------- | --- |
| `rounded-md` (6px) | Badges, menu items, tooltips, small chips. |
| `rounded-lg` (8px) | **Default for controls**: buttons, inputs, selects. |
| `rounded-xl` (12px) | Cards inside a page, popovers, menus, icon tiles. |
| `rounded-2xl` (16px) | Page-level panels, dialogs, sheets. |
| `rounded-full` | Avatars, pills, status dots, counts. |

Avoid arbitrary radii. Use one of the above.

### Typography

The system font stack (`--font-sans`: SF Pro, Inter, Segoe UI) with no
webfont download. Hierarchy comes from size and weight, not colour.

| Role | Classes |
| ---- | ------- |
| Page title | `text-2xl font-semibold tracking-[-0.02em] text-fg` |
| Section title | `text-base font-semibold text-fg` |
| Body | `text-sm text-fg` |
| Secondary | `text-sm text-fg-muted` |
| Meta / timestamps | `text-xs text-fg-subtle tabular-nums` |
| Eyebrow | `text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-subtle` |

Use `tabular-nums` for counts, times and money. Use `text-balance` for
headings that wrap.

### Spacing

The 4px Tailwind scale. Controls are `h-8` (sm), `h-9` (default) or `h-11`
(lg, primary auth/onboarding actions). Card padding is `p-4` or `p-5`; page
gutters are `px-4 sm:px-6`. Mobile touch targets are at least 44px
(`h-11 w-11`).

### Motion

150 ms for colour and border transitions, 200–250 ms for enter animations,
with `ease-out` or `cubic-bezier(0.2, 0.8, 0.2, 1)`. Respect
`prefers-reduced-motion`; `index.css` already disables animation globally for
it.

## Components

Shared primitives live in `src/components/ui`. **Change appearance there, not
at call sites.** Call sites may adjust layout (width, margin, flex, responsive
visibility), not colour, radius, border or shadow.

| Component | Variants |
| --------- | -------- |
| `Button` | `default` (primary), `secondary`, `outline`, `ghost`, `destructive`, `link`; sizes `sm`, `default`, `lg`, `icon`. Icon buttons require `aria-label`. |
| `Badge` | `default`, `secondary`, `outline`, `success`, `warning`, `destructive`, `info`. |
| `Input`, `Textarea`, `Select` | One field style: `field` background, `line-strong` border, neutral focus ring. `aria-invalid` turns the border `danger`. See `apps/web/AGENTS.md` for the Select policy. |
| `Checkbox` | Checked state uses `primary`. |
| `Dialog`, `Popover`, `Tooltip` | `overlay` surface + `shadow-lg`; tooltips are inverse (`bg-fg text-canvas`). |
| `Tabs` | Underline style: active is `border-fg text-fg`. |
| `Skeleton` | `bg-muted` pulse. |

### Patterns

- **Primary action:** one `Button` (default) per view; everything else is
  `outline`, `secondary` or `ghost`.
- **Status pill:** `Badge` with `success`, `warning`, `destructive` or `info`.
  Never build one from palette colours.
- **Empty state:** an icon in a `bg-muted text-fg-muted` circle, a
  `text-base font-semibold` title, a `text-sm text-fg-muted` body, and at
  most one action.
- **Selected list row:** `bg-selected`; hover `bg-subtle`.
- **Unread count:** `bg-primary text-on-primary rounded-full tabular-nums` (in
  the rail: `bg-nav-badge text-on-nav-badge`).
- **Floating chip over the chat canvas:** `bg-overlay/90 backdrop-blur shadow-sm`.
- **Media viewers** (lightbox, attachment preview) stay dark in every theme:
  `bg-black` with `white/NN` overlays. They are the only place raw
  black/white is expected.

## Hard rules (enforced by tests)

`src/styles/design-system.test.ts` fails the build when:

- a component uses a raw Tailwind palette colour (`bg-gray-100`,
  `text-emerald-700`, …);
- a component uses an arbitrary hex colour (`bg-[#0b7a55]`);
- a component uses a legacy name (`*-dark-*`, `*-whatsapp-*`). Aliases still
  exist in `tokens.css` so stray old code keeps working, but new code must not
  use them;
- a `dark:` variant sets a colour;
- a theme is missing a variable, the registry and the CSS disagree, or the
  `index.html` pre-paint list is out of sync.

`white`, `black`, `transparent` and `current` stay allowed for media overlays,
brand tiles and SVG icons. Google's logo colours are allow-listed in the test.

## Checklist for UI changes

1. Use semantic tokens and shared primitives; no new colour values.
2. Check the change in **Light, Dark and WhatsApp** (Settings → Appearance,
   or the theme menu in the rail), on desktop and at 390px wide.
3. Text contrast is at least 4.5:1 (3:1 for large text and icons) in every theme.
4. Run from `apps/web`: `bun test src/styles/design-system.test.ts
   src/components/ui/select-policy.test.ts` and `bun run build`.
