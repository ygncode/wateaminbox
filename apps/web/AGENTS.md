# Web UI conventions

## Design system (read first)

`apps/web/DESIGN.md` is the visual contract: semantic colour tokens, the three
themes (`light`, `dark`, `whatsapp`), elevation, radius, typography and
component patterns. Before any UI change:

- Express colour only through semantic tokens (`bg-surface`, `text-fg-muted`,
  `border-line`, `bg-primary`, `text-accent`, ...). Never use raw palette
  utilities (`bg-gray-100`), arbitrary hex (`bg-[#0b7a55]`), the legacy
  `dark-*`/`whatsapp-*` names, or `dark:` colour overrides. Themes own colour.
- Reuse `src/components/ui` primitives; change appearance there, not at call
  sites.
- Check the result in Light, Dark and WhatsApp.
- Add themes only as described in DESIGN.md ("Adding a theme").
- `bun test src/styles/design-system.test.ts` enforces this in CI.

## Select

Single-choice dropdowns must use `Select`, `SelectTrigger`, `SelectValue`,
`SelectContent`, and `SelectItem` from `@/components/ui/select`.
The shared component owns the field style (see DESIGN.md): field background,
neutral focus ring, consistent chevron, menu states, and theme colours. Change it centrally.
Call sites may only adjust layout/size (width, height, margin, responsive
visibility, compact text). Do not override background, border, radius, shadow,
padding, or focus styles, or import Radix Select directly.

Use visible labels or an accessible name. Preserve disabled/required state,
form names, and validation; use React Hook Form `Controller` for controlled
selects. Radix item values must be nonempty strings. For an explicit clear/all
option, use `EMPTY_SELECT_VALUE` and translate it to the application's empty
value in the change handler; never send the sentinel to an API. For a required
unselected field, use `value=""` with a `SelectValue` placeholder instead.

Searchable/multiple-selection popovers and action menus have different semantics;
do not replace them with a single-choice Select.

Run `bun test src/components/ui/select-policy.test.ts` from `apps/web` when
adding/changing dropdowns. The normal web unit-test CI job also enforces this.
