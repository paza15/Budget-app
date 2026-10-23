/** Test hooks every UI kit component forwards to its root element (docs/SPEC.md §5.8, §9). */
export interface TestIdProps {
  'data-testid'?: string
  /** Id of the record a row shows, so tests can find one entry. */
  'data-id'?: string
}
