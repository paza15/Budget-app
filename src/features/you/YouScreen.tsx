import { useMemo } from 'react'
import { useNav, type Route } from '@/app/nav'
import { ACCENTS, CURRENCIES } from '@/domain/catalog'
import { ordinalDay } from '@/domain/dates'
import { periodOf } from '@/domain/period'
import { needsBackupReminder } from '@/domain/queries'
import type { AccentKey, ThemeMode } from '@/domain/types'
import { BackupDot } from '@/features/you/settings/BackupDot'
import { ProfileGroup } from '@/features/you/settings/ProfileGroup'
import { startOfDayMs } from '@/features/you/settings/text'
import { actions } from '@/store/actions'
import { useCategories, useData, useMoneyFormat, useOwed, useSettings } from '@/store/hooks'
import { useSecurityStore } from '@/store/securityStore'
import { useToday } from '@/store/today'
import { useUiStore } from '@/store/uiStore'
import { ColorSwatches, ListRow, Money, Screen, Section, SelectField, Toggle, type ColorSwatchOption } from '@/ui'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

/** The eight accents with their names; each swatch is its --accent-<key> token (DESIGN.md §4.3). */
const ACCENT_OPTIONS: ColorSwatchOption<AccentKey>[] = ACCENTS.map(({ key, name }) => ({
  value: key,
  name,
  cssVar: `--accent-${key}`,
}))

/** The number-format sample: 1.234,56 € in de-DE. */
const FORMAT_SAMPLE = 123456

function push(route: Route): void {
  useNav.getState().push(route)
}

function back(): void {
  useNav.getState().pop()
}

function changeHideAmounts(hide: boolean): void {
  actions.updateSettings({ hideAmounts: hide })
  // Amounts shown with the eye button earlier hide at once, so the switch visibly works.
  if (hide) useUiStore.getState().setAmountsRevealed(false)
}

/**
 * Settings, "You" (docs/SPEC.md §3.7): pushed on the Home stack from the monogram (§3), with
 * "‹ Home" and a large title (DESIGN.md §9.2). Top to bottom: the profile; Look (Theme, Accent,
 * Show cents in the big number, Home layout); Money (Currency, Number format, Month starts on,
 * Monthly savings), then Categories, Quick add buttons and Owed to you (EXTRAS.md §7.6);
 * Privacy (App lock, Hide amounts); Backup with its reminder dot, and About.
 */
export function YouScreen() {
  const settings = useSettings()
  const money = useMoneyFormat()
  const today = useToday()
  const data = useData((d) => d)
  const categoryCount = useCategories().length
  const quickAddCount = useData((d) => d.quickAdds.length)
  const owed = useOwed()
  const lockOn = useSecurityStore((s) => s.config.pinHash !== null)

  const current = periodOf(today, settings.monthStartDay)
  const thisMonthSavings = useData((d) =>
    Object.hasOwn(d.months, current) ? d.months[current]?.savingsGoal : undefined,
  )
  const backupDue = useMemo(() => needsBackupReminder(data, startOfDayMs(today)), [data, today])
  const currencyName = CURRENCIES.find(({ code }) => code === settings.currency)?.name ?? settings.currency

  return (
    <Screen title="You" largeTitle onBack={back} backLabel="Home">
      <ProfileGroup />

      <Section variant="form" title="Look">
        <SelectField
          label="Theme"
          value={settings.theme}
          options={THEME_OPTIONS}
          onChange={(theme) => actions.updateSettings({ theme })}
        />
        <ColorSwatches
          label="Accent"
          showLabel
          options={ACCENT_OPTIONS}
          value={settings.accent}
          onChange={(accent) => actions.updateSettings({ accent })}
        />
        <Toggle
          label="Show cents in the big number"
          checked={settings.showCents}
          onChange={(showCents) => actions.updateSettings({ showCents })}
        />
        <ListRow title="Home layout" chevron onClick={() => push({ name: 'you.homeLayout' })} />
      </Section>

      <Section variant="form" title="Money">
        <ListRow title="Currency" detail={currencyName} chevron onClick={() => push({ name: 'you.currency' })} />
        <ListRow
          title="Number format"
          detail={money.format(FORMAT_SAMPLE, { unmasked: true })}
          chevron
          onClick={() => push({ name: 'you.numberFormat' })}
        />
        <ListRow
          title="Month starts on"
          detail={ordinalDay(settings.monthStartDay)}
          chevron
          onClick={() => push({ name: 'you.monthStart' })}
        />
        <ListRow
          title="Monthly savings"
          value={<Money cents={settings.savingsGoal} />}
          subtitle={
            thisMonthSavings !== undefined && thisMonthSavings !== settings.savingsGoal ? (
              <>
                This month: <Money cents={thisMonthSavings} />
              </>
            ) : undefined
          }
          onClick={() => useNav.getState().openSheet({ name: 'savingsGoal' })}
        />
      </Section>

      <Section>
        <ListRow
          title="Categories"
          detail={String(categoryCount)}
          chevron
          onClick={() => push({ name: 'you.categories' })}
        />
        <ListRow
          title="Quick add buttons"
          detail={String(quickAddCount)}
          chevron
          onClick={() => push({ name: 'you.quickAdds' })}
        />
        <ListRow
          title="Owed to you"
          value={owed.total > 0 ? <Money cents={owed.total} /> : undefined}
          detail={owed.total > 0 ? undefined : 'None'}
          chevron
          onClick={() => push({ name: 'owed' })}
        />
      </Section>

      <Section
        variant="form"
        title="Privacy"
        footer="With Hide amounts on, numbers show as ••• until you tap the eye at the top of the screen."
      >
        <ListRow title="App lock" detail={lockOn ? 'On' : 'Off'} chevron onClick={() => push({ name: 'you.privacy' })} />
        <Toggle label="Hide amounts" checked={settings.hideAmounts} onChange={changeHideAmounts} />
      </Section>

      <Section>
        <ListRow
          title="Backup"
          detail={backupDue ? <BackupDot /> : undefined}
          label={backupDue ? 'Backup, backup due' : undefined}
          chevron
          onClick={() => push({ name: 'you.backup' })}
        />
        <ListRow title="About" chevron onClick={() => push({ name: 'you.about' })} />
      </Section>
    </Screen>
  )
}
