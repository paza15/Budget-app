import { defineConfig, devices } from '@playwright/test'

const PORT = 4173
// 127.0.0.1, not localhost: on Windows localhost can resolve to IPv6 first while vite preview
// listens on IPv4. A loopback address is a secure context, like localhost.
const ORIGIN = `http://127.0.0.1:${PORT}`
const CI = !!process.env.CI

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  // Locally (4 cores, a dev server and an antivirus beside it) more workers make vite preview
  // drop asset connections; two workers and one retry keep page loads reliable.
  workers: CI ? undefined : 2,
  retries: CI ? 0 : 1,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 15'] } },
    { name: 'chromium-mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
})
