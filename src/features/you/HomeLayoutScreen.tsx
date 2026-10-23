import { useMemo, useState, type MouseEvent } from 'react'
import { useNav } from '@/app/nav'
import { HOME_CARDS } from '@/domain/catalog'
import type { HomeCardKey } from '@/domain/types'
import { HomeCardRow } from '@/features/you/settings/HomeCardRow'
import { arrange, fullOrder } from '@/features/you/settings/rules'
import { useReorder } from '@/features/you/settings/useReorder'
import { actions } from '@/store/actions'
import { useData } from '@/store/hooks'
import { Screen, Section } from '@/ui'

function back(): void {
  useNav.getState().pop()
}

/**
 * You › Home layout (docs/SPEC.md §3.1, §3.7): every Home card with a switch named as in
 * HOME_CARDS ("Show the sums above the total" for the equation) and "Move {name} up" / "Move
 * {name} down" buttons; the top card's up and the bottom card's down are disabled. Settings store
 * the shown cards in order (settings.homeCards); a switched-off card keeps its place in the list.
 */
export function HomeLayoutScreen() {
  const shown = useData((d) => d.settings.homeCards)
  // Initialised once from the stored cards (never synced in an effect): it only remembers where
  // the hidden cards sit while the user arranges them.
  const [order, setOrder] = useState<HomeCardKey[]>(() => fullOrder(shown))
  const list = useMemo(() => arrange(order, shown), [order, shown])
  const { listRef, status, move: moveRow } = useReorder()

  const show = (key: HomeCardKey, on: boolean) => {
    setOrder(list)
    const next = on ? list.filter((card) => card === key || shown.includes(card)) : shown.filter((card) => card !== key)
    actions.updateSettings({ homeCards: next })
  }

  const move = (event: MouseEvent<HTMLButtonElement>, key: HomeCardKey, delta: -1 | 1, name: string) => {
    moveRow(event, list, key, delta, name, (next) => {
      setOrder(next)
      const homeCards = next.filter((card) => shown.includes(card))
      if (homeCards.some((card, i) => card !== shown[i])) actions.updateSettings({ homeCards })
    })
  }

  return (
    <Screen title="Home layout" largeTitle onBack={back} backLabel="You">
      <Section footer="Home shows the cards in this order and leaves out a card while it has nothing to show. The total at the top always shows.">
        <div ref={listRef}>
          {list.map((key, index) => {
            const card = HOME_CARDS.find((option) => option.key === key)
            if (card === undefined) return null
            return (
              <HomeCardRow
                key={key}
                cardKey={key}
                name={card.name}
                description={card.description}
                shown={shown.includes(key)}
                first={index === 0}
                last={index === list.length - 1}
                onShow={(on) => show(key, on)}
                onMove={(event, delta) => move(event, key, delta, card.name)}
              />
            )
          })}
        </div>
      </Section>
      <output className="visually-hidden">{status}</output>
    </Screen>
  )
}
