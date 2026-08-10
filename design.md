# Design — Ember control plane

A locked design system for this app. Every page redesign reads this file before
emitting code. Do not regenerate per page — extend or amend this file when the
system needs to grow.

/* Hallmark · genre: modern-minimal · design-system: design.md · designed-as-app
 * macrostructure family: Workbench (app) · Quiet card (auth)
 * tone: utilitarian · technical · austere
 */

## Genre
modern-minimal

## Macrostructure family
- Marketing pages: none (product is the console)
- App pages: Workbench — dense data, flat chrome, hairline borders, no hero enrichment
- Auth pages: Quiet single-card on flat paper (no atmospheric stage)

## Theme
Dark ops panel. Cool near-black paper, high-contrast ink, one ember accent ≤ 5% of viewport.

- `--color-paper`     oklch(0.145 0.008 260)
- `--color-paper-2`   oklch(0.175 0.008 260)
- `--color-paper-3`   oklch(0.21 0.008 260)
- `--color-ink`       oklch(0.93 0.01 260)
- `--color-ink-2`     oklch(0.72 0.01 260)
- `--color-ink-3`     oklch(0.55 0.01 260)
- `--color-rule`      oklch(0.28 0.01 260)
- `--color-accent`    oklch(0.68 0.17 45)
- `--color-accent-ink` oklch(0.16 0.02 45)
- `--color-focus`     oklch(0.72 0.14 45)
- `--color-success`   oklch(0.72 0.12 150)
- `--color-warning`   oklch(0.78 0.12 85)
- `--color-danger`    oklch(0.65 0.18 25)

## Typography
- Display / body: Inter, weight 400–600, style normal (no italic headers)
- Mono: JetBrains Mono, weight 400–500 (IDs, logs, install commands, metrics)
- Display tracking: -0.02em on titles
- Type scale: page title 1.375rem / 600; section label 0.6875rem / 500 / 0.06em caps; body 0.875rem

## Spacing
4-point named scale in `web/app/globals.css` (`--space-*`). Prefer Tailwind spacing utilities mapped to the same rhythm.

## Motion
- Easings: `--ease-out: cubic-bezier(0.16, 1, 0.3, 1)`
- Duration: `--dur-short: 120ms` max for hover opacity
- Reveal pattern: none
- Reduced-motion: no animation
- Logo: static (no pulse / flicker)

## Microinteractions stance
- Silent success (no celebratory toasts)
- Hover delay for tooltips 800ms; focus 0ms
- Buttons: flat fill, no gradient, no glow shadow
- Focus: 2px solid accent ring, instant, never animated

## CTA voice
- Primary: solid accent fill, 4px radius, ink-on-accent, font-medium 0.875rem
- Secondary: 1px rule border, transparent fill, ink-2 text
- Destructive: danger border / text; solid danger only for confirmed destructive

## Shell / nav
- Nav archetype: N3 side-rail (cleaned)
- Top bar: wordmark + search + tenant/user meta (no blur glass)
- Kill decorative single-letter badges on expanded nav
- Footer rail: environment meta only (“Environment / SQLite”) — not “Hearth”

## Per-page allowances
- App pages MUST NOT use enrichment, gradient text, glass, multi radial backgrounds
- Auth pages: flat paper, single panel, no hearth stage
- Accent only for primary CTAs, active nav, focus rings, brand mark

## What pages MUST share
- Wordmark (static Ember mark)
- Accent colour and sparse placement
- Inter + JetBrains Mono
- CTA voice (shape, radius, padding)
- Panel = paper-2 + 1px rule, 6px radius, no backdrop-blur

## What pages MAY differ on
- Content density and table layout
- Whether PageHeader shows an eyebrow (prefer sparse; one word max when used)

## What we removed (slop)
- Multi radial “hearth” body backgrounds
- CSS grain overlay
- Logo pulse / flicker animations
- Gradient buttons and gradient text
- Backdrop-blur glass panels
- Glow box-shadows (`shadow-ember*`)
- Uppercase wide-tracked orange eyebrows as default chrome
- “Keep the fire lit” / “Hearth” marketing chrome in the shell

## Exports

### tokens.css (also mirrored in `web/app/globals.css`)
```css
:root {
  color-scheme: dark;
  --color-paper: oklch(0.145 0.008 260);
  --color-paper-2: oklch(0.175 0.008 260);
  --color-paper-3: oklch(0.21 0.008 260);
  --color-ink: oklch(0.93 0.01 260);
  --color-ink-2: oklch(0.72 0.01 260);
  --color-ink-3: oklch(0.55 0.01 260);
  --color-rule: oklch(0.28 0.01 260);
  --color-accent: oklch(0.68 0.17 45);
  --color-accent-ink: oklch(0.16 0.02 45);
  --color-focus: oklch(0.72 0.14 45);
  --font-display: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-body: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;
  --radius-control: 4px;
  --radius-panel: 6px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --dur-short: 120ms;
}
```
