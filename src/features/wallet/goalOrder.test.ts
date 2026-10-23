import { describe, expect, it } from 'vitest'
import { makeGoal, TODAY } from '@/domain/test-helpers/dataFixtures'
import { walletSummary } from '@/domain/wallet'
import { movedGoalOrder } from '@/features/wallet/goalOrder'
import { BIKE, JACKET, JAPAN, walletData } from '@/features/wallet/testData'

describe('movedGoalOrder (docs/SPEC.md §3.14 order buttons)', () => {
  const goals = [JACKET, JAPAN, BIKE]
  const active = walletSummary(walletData({ goals }), TODAY).goals

  it('trades places with the neighbour and keeps a done goal where it was', () => {
    // Winter jacket (done) keeps the first place, so "Put back" returns it there.
    expect(movedGoalOrder(goals, active, BIKE.id, 'up')).toEqual([JACKET.id, BIKE.id, JAPAN.id])
    expect(movedGoalOrder(goals, active, JAPAN.id, 'down')).toEqual([JACKET.id, BIKE.id, JAPAN.id])
  })

  it('moves only within the active goals', () => {
    const later = makeGoal({ id: 'goal-old', name: 'Old', order: 3, doneAt: 5 })
    const all = [JACKET, JAPAN, later, BIKE].map((goal, i) => ({ ...goal, order: i }))
    const fill = walletSummary(walletData({ goals: all }), TODAY).goals
    // The done goal between them stays in its slot; the two active goals swap around it.
    expect(movedGoalOrder(all, fill, 'goal-bike', 'up')).toEqual(['goal-jacket', 'goal-bike', 'goal-old', 'goal-japan'])
  })

  it('lists every goal in the domain’s fill order: ties by createdAt, then id', () => {
    const a = makeGoal({ id: 'a', order: 1, createdAt: 5 })
    const b = makeGoal({ id: 'b', order: 1, createdAt: 2 })
    const c = makeGoal({ id: 'c', order: 0, doneAt: 9 })
    const d = makeGoal({ id: 'd', order: 1, createdAt: 2 })
    const all = [a, b, c, d]
    const fill = walletSummary(walletData({ goals: all }), TODAY).goals
    expect(fill.map((state) => state.goal.id)).toEqual(['b', 'd', 'a'])
    // Fill order c (done), b, d, a: "a" trades places with "d", and "c" keeps the first slot.
    expect(movedGoalOrder(all, fill, 'a', 'up')).toEqual(['c', 'b', 'a', 'd'])
  })

  it('cannot move past either end, or a goal that is not active', () => {
    expect(movedGoalOrder(goals, active, JAPAN.id, 'up')).toBeNull()
    expect(movedGoalOrder(goals, active, BIKE.id, 'down')).toBeNull()
    expect(movedGoalOrder(goals, active, JACKET.id, 'down')).toBeNull()
    expect(movedGoalOrder(goals, active, 'missing', 'up')).toBeNull()
  })
})
