# WATeamInbox design system

The visual contract for `apps/web`. Read this before changing any UI. The rules
in **Hard rules** are enforced by `src/styles/design-system.test.ts`, which runs
in CI with the rest of the web unit tests.

## Principles

WATeamInbox should feel **premium, enterprise and minimal**. It is a tool that
people keep open all day, so it should feel calm.

1. **Monochrome first.** Neutral surfaces, hairline borders and a near-black
   (or near-white) primary action. Colour is information, not decoration.
2. **One accent with a job.** `accent` marks links and the active place;
   `signal` marks live/online. Neither is used for decoration, large fills or
   glows.
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
| `light`    | light      | Intercom: putty canvas, one floating white workspace, ink-black actions, one confident blue (`#2453ec`) for links, unread and outgoing. |
| `dark`     | dark       | X "Lights out": true black, no floating cards, `#2f3336` hairlines between columns, white pill actions, X blue (`#1d9bf0`) accent. |
| `whatsapp` | dark       | Today's WhatsApp Web dark: neutral charcoal `#161717`, rounded inset selection, deep-green outgoing bubbles, `#21c063` actions and unread. |

**WhatsApp follows current WhatsApp Web**, not the 2020s teal original
(`cbf7de7b`, retired on 2026-11-21). Keep it recognisably WhatsApp: neutral
charcoal, green only for actions, unread and the active filter.

**Inbox list.** One row of search + account scope + new contact, one
segmented lifecycle control, and one Filter menu holding assignment and tags.
Rows name the receiving account only when the inbox has more than one account
and is not already scoped to one; status shows only for Pending. Stat cards
are neutral: no per-card colours.

**`whatsapp` is the default for everyone** (`DEFAULT_THEME_PREFERENCE`): a
browser that has never chosen a theme, and every account without a saved
choice. Signing out keeps the last theme, so /login and /register stay in the
look the user picked. A user may pick `system`
(follows the OS between `light` and `dark`) or any theme id; the choice is
saved on their account (`users.theme_preference`) and follows them across
devices. `localStorage["wateaminbox-theme"]` is only a paint cache.

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
| `canvas` | App background behind everything (the rail sits on it). |
| `page` | Background of a page *inside* the content frame (dashboard, team, settings). |
| `panel` | Navigation and list columns (conversation list, settings nav). |
| `surface` | Cards, thread header, tables, dialogs: the default container. |
| `raised` | Controls that sit on a surface: secondary chips and buttons. |
| `subtle` | Quiet bands inside a surface: table headers, footers, read-only fields, hover on surface rows. |
| `muted` | Chips, segmented controls, secondary buttons, skeletons, hover on interactive items. |
| `muted-strong` | Pressed/hover state of `muted`, progress tracks. |
| `selected` | The currently open row in a list (conversation, group). Add `list-row-selected` for the theme's inset ring. |
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
| `primary` / `primary-hover` / `on-primary` | The main call to action. One per view. Near-black in `light`, near-white in `dark`, WhatsApp green in `whatsapp`. |
| `ring` | Focus ring colour (`ring-ring/40`). |
| `accent` / `accent-hover` / `accent-soft` / `on-accent` | Links, active nav/settings items, emphasised numbers. Blue in `light`/`dark`, green in `whatsapp`. |
| `signal` / `on-signal` | Online and live dots, sync indicators. **Never an action colour.** |
| `unread` / `on-unread` | Unread count pills in conversation lists. |
| `success`, `success-soft` | Completed or positive state. |
| `warning`, `warning-soft` | At risk: SLA about to breach, needs review. |
| `danger`, `danger-hover`, `danger-soft`, `on-danger` | Errors, failed delivery, destructive actions, overdue. |
| `info`, `info-soft` | Neutral information, links inside content, read receipts. |

Soft variants are for backgrounds of badges, banners and icon tiles. Pair them
with the solid token as text: `bg-warning-soft text-warning`.

### Layout chrome

| Token / class | Use |
| ------------- | --- |
| `.app-frame` | The content column. On desktop it floats on the canvas with `--frame-gap`, `--frame-radius`, `--frame-border` (Light/Dark: 8px inset, 12px radius; WhatsApp: 0, flush like WhatsApp Web). |
| `.list-row` | Conversation/group rows. Inset and rounded via `--row-inset`, `--row-radius`; divider via `border-row-line` (transparent in Light/Dark). |
| `chip`, `chip-line`, `chip-on`, `on-chip-on` | Filter chips (status/assignment filters). |
| `tab-on` | Active tab underline and label. |
| `row-hover` | Hover on list rows. |
| `monogram`, `on-monogram` | Workspace monogram avatar. |
| `section` | Section headings inside panels (Contact Info, settings groups). Ink in every theme. |
| `bar`, `on-bar`, `bar-line`, `bar-hover` | Title bar of right panels and mobile sheets. Surface-coloured in every theme. Never use `bg-primary` for chrome. |

**Rules that keep it premium**

- A filled `bg-primary` control hovers to `bg-primary-hover`, nothing else. Never hover a primary fill to `accent-soft` or `accent/90`.
- Lines use `border-line` / `border-line-strong` at full strength. No opacity modifiers on line tokens (`border-line/[0.06]`): they vanish on dark themes.
- Live/connected dots use `bg-signal`, never `bg-primary`.

### Navigation rail

The app rail and the auth/onboarding side panel use their own tokens. Use only `nav`, `nav-fg`, `nav-fg-muted`,
`nav-hover`, `nav-active`, `nav-active-fg`, `nav-badge`, `on-nav-badge`,
`nav-fg-subtle`, `nav-line` and `nav-card` there, never surface tokens. In
Light the rail blends into the canvas (Intercom); in Dark it is the same black
as everything else, split by a hairline (X); in WhatsApp it is the original
deep green.

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
| `Skeleton` | `bg-muted` pulse. Page and list placeholders follow "Loading skeletons" below. |

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

## Loading skeletons

A skeleton is a promise about layout: when data arrives, **content changes and
nothing moves**. Every skeleton is sized against the loaded UI it stands in
for, at desktop (1440×900) and mobile (390×844), in all three themes.

**Where they live**

| Loading state | Component |
| ------------- | --------- |
| Cold load / route guards (with the app shell) | `PageSkeleton withShell` in `components/ui/page-skeleton.tsx` |
| Lazy page chunk inside the shell | `PageSkeleton variant=…` (App `LazyPage`) |
| Inbox list rows and toolbar | `components/chat/ChatListSkeleton.tsx` |
| Conversation header, canvas, composer | `components/chat/ConversationMessagesSkeleton.tsx` |
| ServerDataTable pages, page headers | `components/ui/table-skeleton.tsx`; tables take `loadingRowHeight` |
| Notifications, contact profile, group rows, stat cards, chart panels | next to the real component |
| Auth routes | the onboarding frame (`OnboardingLoadingScreen`) |

**Rules**

- **Copy the real classes, not numbers.** A skeleton band uses the same
  container classes as its real counterpart (padding, height, border,
  radius, `list-row`, inset classes). Share a component when the real UI and
  its placeholder can use one (`ComposerSkeleton`, `ChatListRowSkeleton`).
- **One text line = one line box.** Text is a bar centred in a box exactly as
  tall as the real line (`SkeletonLine className="h-5"` for `text-sm`,
  `h-4` for `text-xs`). A bare `h-3` bar is 4–8px shorter than the text it
  replaces and shifts everything below it.
- **Content-sized rows use measured heights.** Table rows depend on their
  cells; pass the measured height (`loadingRowHeight`) instead of guessing
  padding.
- **Match responsive behaviour.** If the real header wraps, stacks or hides
  an element at a breakpoint, the skeleton does the same.
- **Mark landmarks with `data-sk`.** Real components and skeletons put the
  same `data-sk="<landmark>"` on the boxes that define layout (rail, list
  rows, thread header, composer, page header, card, toolbar, table head/rows/
  footer, …). `src/components/ui/skeleton-landmarks.test.ts` fails when a
  skeleton landmark has no real counterpart or a measured landmark loses its
  marker.

**When you change a layout, update its skeleton in the same change.** Then
measure, from `apps/web`, against a running stack:

```sh
PLAYWRIGHT=<path to playwright/index.mjs> SK_EMAIL=<user> SK_PASSWORD=<pw> \
SK_THEME=whatsapp SK_OUT=../../tmp/skeleton/run \
node scripts/measure-skeletons.mjs
```

It loads each route three ways (loaded, cold-load shell, page data held),
compares every `data-sk` box and exits non-zero beyond 3px. Run it for
`light`, `dark` and `whatsapp`. Screenshots land in `SK_OUT` for a visual pass.

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
4. Changed a layout? Update its loading skeleton too and run
   `scripts/measure-skeletons.mjs` (see "Loading skeletons").
5. Run from `apps/web`: `bun test src/styles/design-system.test.ts
   src/components/ui/select-policy.test.ts
   src/components/ui/skeleton-landmarks.test.ts` and `bun run build`.
