/** Joins class names, skipping empty ones (a CSS Modules class is undefined when it is not defined). */
export function classNames(...names: (string | false | null | undefined)[]): string | undefined {
  const joined = names.filter(Boolean).join(' ')
  return joined === '' ? undefined : joined
}
