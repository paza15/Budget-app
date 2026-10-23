import type { SavingsGoal } from '@/domain/types'
import { goalsInFillOrder, type GoalState } from '@/domain/wallet'

/**
 * The ids to give actions.reorderGoals when the active goal `id` moves one place up ("Fill {name}
 * sooner") or down ("later") among the active goals (`active`, in fill order; docs/SPEC.md §3.14):
 * it trades places with its active neighbour, and every done goal keeps its place in the fill order
 * (goalsInFillOrder), so a goal put back later still lands where it was. reorderGoals moves goals
 * it is not given to the end, so every goal is listed. Null when the goal cannot move that way.
 */
export function movedGoalOrder(
  goals: readonly SavingsGoal[],
  active: readonly GoalState[],
  id: string,
  direction: 'up' | 'down',
): string[] | null {
  const index = active.findIndex((state) => state.goal.id === id)
  if (index < 0) return null
  const neighbour = active[direction === 'up' ? index - 1 : index + 1]
  if (neighbour === undefined) return null
  const ids = goalsInFillOrder(goals).map((goal) => goal.id)
  const from = ids.indexOf(id)
  const to = ids.indexOf(neighbour.goal.id)
  if (from < 0 || to < 0) return null
  return ids.with(from, neighbour.goal.id).with(to, id)
}
