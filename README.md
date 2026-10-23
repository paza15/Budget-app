# On a Budget

A private monthly budget app for iPhone. It keeps your fixed costs, your daily spending and what
you save on your phone, and nowhere else.

- **Home** shows what's left this month and per day, with the month written out as a sum: income,
  minus fixed costs, savings and daily spending.
- **Daily** is for everyday spending like coffee. Add an expense with the keypad, or in one tap
  with a quick add.
- **Fixed** holds rent, subscriptions, transport and your income, grouped by category, with a tick
  for what's been paid this month.
- **Wallet** keeps what you don't spend. When a month closes, its savings and what was left move
  in; an overspent month takes the difference out. Savings goals fill from the wallet, and a big
  purchase can be paid from it without touching the month's budget.
- **Month-end review and split bills**: a short statement for each closed month, and shared bills
  that count only your share until the others pay you back.
- **Yours to set up**: categories with icons and monthly limits, light and dark themes, accent
  colours, your currency and number format, the day your month starts, and an app lock with a
  PIN and Face ID.

## Privacy

There is no account, no server and no analytics. Everything you enter stays in the app's storage
on your iPhone, and the app makes no network requests except to download its own updates. Anyone
else who opens the address gets their own empty app.

## Install on your iPhone

It's a web app that you add to your Home Screen. On iOS 26:

1. Open the app's address in Safari (for example `https://<your-github-name>.github.io/Budget-app/`).
2. Tap ••• next to the address bar (or Share if you see it), then tap Share.
3. Tap Add to Home Screen. It may be under View More.
4. Leave Open as Web App on and tap Add.
5. Open On a Budget from your Home Screen and set it up there.

Set it up in the installed app, not in Safari: the two keep separate data, and Safari may delete
a site's data after 7 days without a visit. If you open the address in Safari, the app shows
these steps.

## Keep your data safe

- Removing the app from your Home Screen deletes its data. Export a backup now and then: tap your
  initial (or the person icon) at the top of Home, then Backup, then Export backup, and save the
  file to Files or iCloud Drive. A dot on that button reminds you when a backup is due.
- To move to a new iPhone, export a backup, install the app on the new phone and choose Restore
  from a backup on the welcome screen.
- Always open the app from the same address. Its data, Face ID unlock and Home Screen install are
  tied to that address.

## Development

Needs Node 22 or later.

```sh
npm ci
npm run dev       # dev server, also reachable from a phone on the same Wi-Fi
npm run check     # typecheck, lint, unit tests and a production build
npm run e2e       # Playwright on WebKit (iPhone 15) and Chromium (Pixel 7)
```

The dev server's Wi-Fi address isn't a secure context, so the app lock, Face ID, sharing and
offline mode only work on the deployed HTTPS address.

- How the app behaves and is built: [docs/SPEC.md](docs/SPEC.md)
- How it looks: [docs/DESIGN.md](docs/DESIGN.md), [docs/design/EXTRAS.md](docs/design/EXTRAS.md)
  (the month-end review, split bills and the settings button) and
  [src/styles/tokens.css](src/styles/tokens.css)
- Rules for working on the code: [CLAUDE.md](CLAUDE.md)

## Deploy

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) checks the code, builds the app for
`/<repository name>/` and publishes it to GitHub Pages on every push to `main`. Turn it on once
under Settings → Pages → Build and deployment → Source: GitHub Actions.

Keep the address once you use the app. Before you move it to another host or path, export a
backup from the old one.
