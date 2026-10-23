import { initialOf } from '@/features/owed/owedModel'
import styles from '@/features/owed/PersonCoin.module.css'
import { Coin } from '@/ui'

/**
 * A person as a plain coin: the initial in SF Pro 600 in a hairline ring (docs/design/EXTRAS.md
 * §2.3; the engraved rim stays the owner's monogram). 34px with a 15px initial (rows), 26px with a
 * 12px initial (the Owed screen's person headers). Decorative: the row names the person.
 */
export function PersonCoin({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  return (
    <Coin size={size}>
      <span className={size === 'sm' ? styles.small : styles.initial}>{initialOf(name)}</span>
    </Coin>
  )
}
