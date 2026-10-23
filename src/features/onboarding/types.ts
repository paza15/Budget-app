/** What every step after Welcome gets from Onboarding: where it stands and where to go. */
export interface StepNav {
  /** Position among the steps that apply, for the progress ruler. */
  progress: { index: number; count: number }
  /** How the step arrived (Continue or Back), for its entrance; null on the first render. */
  direction: 'forward' | 'back' | null
  /** Continue, or Skip: the next step that applies. */
  onNext(): void
  /** The previous step that applies. */
  onBack(): void
}
