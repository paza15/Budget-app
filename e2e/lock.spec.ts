import { enablePin, expect, lockScreen, lockSupported, seed, test, typeKeys, waitForApp } from './fixtures.ts'

// App lock (docs/SPEC.md §3.8, §8). PIN hashing needs WebCrypto in a secure context; 127.0.0.1 is
// one, but a browser build without crypto.subtle cannot run this flow.

test('a PIN locks the app on launch and only the right PIN opens it', async ({ page }) => {
  await seed(page, 'empty-onboarded')
  test.skip(!(await lockSupported(page)), 'App lock needs isSecureContext and crypto.subtle')

  await enablePin(page, '1234')

  // Cold start with a PIN: only the lock screen renders until the first unlock.
  await page.reload()
  await waitForApp(page)
  const lock = lockScreen(page)
  await expect(lock).toBeVisible()
  await expect(lock.getByText('Enter your PIN')).toBeVisible()
  await expect(page.getByTestId('tab-home')).toHaveCount(0)

  const dots = lock.getByTestId('pin-dots')
  await expect(dots).toHaveAttribute('data-filled', '0')
  await typeKeys(lock, '12')
  await expect(dots).toHaveAttribute('data-filled', '2')
  await lock.getByTestId('keypad-back').click()
  await expect(dots).toHaveAttribute('data-filled', '1')
  await lock.getByTestId('keypad-back').click()
  await expect(dots).toHaveAttribute('data-filled', '0')

  // A wrong PIN shakes the dots, says so and clears them.
  await typeKeys(lock, '0000')
  await expect(lock.getByText('Wrong PIN')).toBeVisible({ timeout: 15_000 })
  await expect(dots).toHaveAttribute('data-filled', '0')
  await expect(lock).toBeVisible()
  await expect(page.getByTestId('tab-home')).toHaveCount(0)

  await typeKeys(lock, '1234')
  await expect(lock).toBeHidden({ timeout: 15_000 })
  await expect(page.getByTestId('tab-home')).toBeVisible()
  await expect(page.getByTestId('screen-home')).toHaveAttribute('data-active', 'true')
})
