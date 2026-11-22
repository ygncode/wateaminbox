# Repository guide

## Web UI

Any change under `apps/web` must follow `apps/web/DESIGN.md` (design system:
semantic tokens, themes, components) and `apps/web/AGENTS.md` (web
conventions). Colour comes only from semantic tokens; themes (`light`, `dark`,
`whatsapp`) own every colour value. `apps/web/src/styles/design-system.test.ts`
enforces this in CI. A layout change also updates its loading skeleton
(DESIGN.md → "Loading skeletons").
