# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Start dev server with HMR (Vite)
npm run build      # Production build → dist/
npm run preview    # Preview the production build locally
npm run lint       # Run oxlint
```

No test suite is configured.

## Architecture

This is a single-page marketing website for **Spottex** — a Czech-language solar energy optimization SaaS. It is built with React 19 + Vite 8 and has no routing, no state management library, and no backend calls.

**All source code lives in two files:**

- `src/App.jsx` — the entire application. Contains all page sections as top-level components (`Nav`, `Hero`, `ProblemSection`, `SolutionSection`, `HowSection`, `PricingSection`, `FaqSection`, `CtaSection`, `Footer`) composed sequentially in the default export `App`. Only interactive state is the FAQ accordion (`useState` in `FaqSection`). All media assets are hotlinked from `framerusercontent.com` via constants at the top of the file.
- `src/index.css` — all styles. No CSS modules, no Tailwind. Uses CSS custom properties defined in `:root` for the design system (colors: `--green`, `--dark`, etc.; fonts: Poppins for headings, Inter for body). Each section has its own BEM-like class namespace.

**External links:** CTAs point to `https://app.spottex.cz/signup`. App Store / Google Play links are placeholder `#` hrefs.

## Linting

oxlint is configured in `.oxlintrc.json` with the `react` and `oxc` plugins. Rules enforced: `react/rules-of-hooks` (error), `react/only-export-components` (warn, allows constant exports).
