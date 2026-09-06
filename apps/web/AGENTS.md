# Web UI conventions

Single-choice dropdowns must use `Select`, `SelectTrigger`, `SelectValue`,
`SelectContent`, and `SelectItem` from `@/components/ui/select`.
The shared component owns the inbox theme: gray trigger, green focus ring,
consistent chevron, menu states, and dark-mode colors. Change it centrally.
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
