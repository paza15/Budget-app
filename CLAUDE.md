# On a Budget: private budget app for iPhone

Installable web app (PWA) built with React 19, TypeScript 6 and Vite 8. All data stays on the
device in IndexedDB. The app never sends data anywhere; its only network traffic is the service
worker fetching new versions of the app from its own host.

- Behaviour and architecture spec: `docs/SPEC.md` (source of truth; section numbers are stable)
- Visual design: `docs/DESIGN.md`, tokens in `src/styles/tokens.css`
- Data contract: `src/domain/types.ts`

## Commands

- `npm run dev`: dev server, reachable from a phone on the same Wi-Fi. That address is not a secure
  context, so app lock, Face ID, sharing, persistent storage and the service worker don't work there;
  test those on the deployed HTTPS URL.
- `npm run typecheck`: `tsc -b`
- `npm run lint`: oxlint, warnings fail
- `npm test`: Vitest once (`npx vitest run src/domain/money.test.ts` for one file). `*.test.ts` run in
  node, `*.test.tsx` in jsdom, with TZ=Europe/Berlin.
- `npm run build`: typecheck plus production build into `dist/`
- `npm run e2e`: Playwright (builds, serves on :4173, runs WebKit iPhone and Chromium mobile)
- `npm run check`: typecheck, lint, unit tests, build

## Rules

- Money is an integer number of hundredths of the major unit (`Cents`), whatever the currency.
  Never floats. Parse and format only with `src/domain/money.ts`.
- Dates are local `'YYYY-MM-DD'` strings (`ISODate`) built only by `src/domain/dates.ts`. Never
  `new Date('YYYY-MM-DD')` (parses as UTC) and never `toISOString()` for calendar dates.
- A "month" is a budget period key `'YYYY-MM'` (the month it starts in). `monthStartDay` may be 25,
  so never assume calendar months; use `src/domain/period.ts`.
- Layers: `src/domain` is pure TypeScript; `src/store` never imports UI; `src/ui` never imports the
  store (money settings come from `MoneyFormatContext`); features import from the shell only
  `@/app/nav`, `@/app/MonthSwitcher` and `@/app/undo`. oxlint enforces this.
- Components never mutate data directly: call `actions` from `src/store/actions.ts`; read with the
  hooks in `src/store/hooks.ts`; show money with `<Money>` / `<BigAmount>` or `useMoneyFormat()`.
- Zustand 5 has no selector equality: a selector returns a store value unchanged, a primitive, or
  (inside `useShallow`) a flat object/array of existing references. Never compute or allocate in a
  selector; derived data goes through `src/store/selectors.ts` or `useMemo`. Fallbacks are frozen
  module constants, never `?? {}`.
- React: never copy props or store values into state in an effect (derive, or reset with a `key`);
  never call `Date.now()`/`new Date()` during render (use `useToday()`); never read `ref.current`
  during render; never declare a component inside another; call `actions.*` and `toast()` only from
  event handlers. Event listeners read current state with `getState()`.
- Colours, type, spacing, radii, motion and z-index come only from CSS variables in
  `src/styles/tokens.css`. No hex or rgb literals in components. Category colours are for marks and
  badges, never for text.
- Styles are CSS Modules next to their component (`Foo.module.css`). Imports use the `@/` alias.
- No external fonts, scripts, images or analytics. Everything ships in the bundle.
- UI copy: English, sentence case, active verbs, no exclamation marks, no all-caps labels, no
  metadata joined with " · ". Errors say what happened and how to fix it.
- iOS: inputs at least 16px, touch targets at least 44×44px, `100dvh` (never `100vh`),
  `env(safe-area-inset-*)` on every edge, `-webkit-` prefixes for `backdrop-filter` and `user-select`.
- Tests sit next to the code (`*.test.ts` / `*.test.tsx`). Every exported domain function has unit
  tests. E2E specs live in `e2e/` and prefer accessible names, then the test ids in SPEC §9.
