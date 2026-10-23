/**
 * CSS Modules in jsdom tests. Vitest blanks CSS Modules on import (the class names resolve, the
 * rules do not), and jsdom has no layout. These helpers read a module's rules as written, resolve
 * lengths against tokens.css, and put a module's rules into the test document under the class
 * names Vitest gives it, so getComputedStyle and the accessible queries (display: none) see them.
 * Tests only: nothing in the app imports this file.
 */

// Node built-ins come in through import(string), as in src/ui/ListRow.test.tsx: typing them would
// pull @types/node into the app's type program.
const fs = (await import('node:fs' as string)) as { readFileSync(path: URL, encoding: 'utf8'): string }

/**
 * A file next to the calling test, e.g. readSibling(import.meta.url, 'Screen.module.css'). The
 * URL is built at run time, so Vite never turns it into an asset import.
 */
export function readSibling(testUrl: string, name: string): string {
  return fs.readFileSync(new URL(name, testUrl), 'utf8')
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '')
}

function declarations(body: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const declaration of body.split(';')) {
    const at = declaration.indexOf(':')
    if (at > 0) found[declaration.slice(0, at).trim()] = declaration.slice(at + 1).trim()
  }
  return found
}

/**
 * The rules of `source` by selector, with their declarations. Rules inside an at-rule are left
 * out unless `within` names it, e.g. '@media (prefers-reduced-motion: reduce)'. A selector that
 * appears twice keeps its declarations merged, later ones winning.
 */
export function cssRules(source: string, within?: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>()
  const text = withoutComments(source)
  const scopes: string[] = []
  let buffer = ''
  let rule: string | null = null
  for (const char of text) {
    if (char === '{') {
      const prelude = buffer.trim()
      buffer = ''
      if (prelude.startsWith('@')) scopes.push(prelude.replace(/\s+/g, ' '))
      else rule = prelude.replace(/\s+/g, ' ')
    } else if (char === '}') {
      if (rule !== null) {
        if (scopes.at(-1) === within) rules.set(rule, { ...rules.get(rule), ...declarations(buffer) })
        rule = null
      } else {
        scopes.pop()
      }
      buffer = ''
    } else {
      buffer += char
    }
  }
  return rules
}

/** The declarations of one rule, failing the test when the module has no such rule. */
export function cssRule(source: string, selector: string, within?: string): Record<string, string> {
  const found = cssRules(source, within).get(selector)
  if (found === undefined) throw new Error(`No rule "${selector}"${within ? ` in ${within}` : ''}`)
  return found
}

const tokensSource = fs.readFileSync(
  new URL(['..', '..', 'styles', 'tokens.css'].join('/'), import.meta.url),
  'utf8',
)

/** The custom properties of tokens.css's first :root block (the light theme and the shared scales). */
const TOKENS: ReadonlyMap<string, string> = (() => {
  const body = /:root\s*\{([^}]*)\}/.exec(withoutComments(tokensSource))?.[1] ?? ''
  const found = new Map<string, string>()
  for (const [name, value] of Object.entries(declarations(body))) if (name.startsWith('--')) found.set(name, value)
  return found
})()

/**
 * A length in px: var() resolved from tokens.css (or its fallback), then calc() of px terms added
 * and subtracted, e.g. 'calc(var(--space-2) + var(--space-0-5))' → 10. Anything else (em, %,
 * products) throws, so a test never compares against a guess.
 */
export function px(value: string | undefined): number {
  if (value === undefined) throw new Error('No length to read: the rule does not set that property')
  let resolved = value.trim()
  for (let pass = 0; pass < 8 && resolved.includes('var('); pass += 1) {
    resolved = resolved.replace(/var\((--[\w-]+)(?:,\s*([^()]*))?\)/g, (_, name: string, fallback?: string) => {
      const token = TOKENS.get(name) ?? fallback
      if (token === undefined) throw new Error(`tokens.css has no ${name}`)
      return token.trim()
    })
  }
  const expression = /^calc\((.*)\)$/s.exec(resolved)?.[1] ?? resolved
  const terms = expression.replace(/\s+/g, '').match(/[+-]?[^+-]+/g) ?? []
  let total = 0
  for (const term of terms) {
    const parts = /^([+-]?)(\d+(?:\.\d+)?)px$/.exec(term)
    if (parts === null) throw new Error(`Cannot add up "${value}" in px`)
    total += (parts[1] === '-' ? -1 : 1) * Number(parts[2])
  }
  return total
}

/**
 * The class name a CSS Module gives `name`, failing the test when the module has no such class
 * (an index into a module's classes is typed string | undefined).
 */
export function classOf(classes: Readonly<Record<string, string | undefined>>, name: string): string {
  const found = classes[name]
  if (found === undefined) throw new Error(`The module has no class "${name}"`)
  return found
}

/** Rewrites the class selectors of a module's selector list to the names the module resolves to. */
function mapSelectors(prelude: string, classes: Readonly<Record<string, string>>): string {
  return prelude.replace(/:global\(([^()]*)\)|\.(-?[_a-zA-Z][\w-]*)/g, (_, global?: string, name?: string) =>
    global !== undefined ? global : `.${classes[name ?? ''] ?? name}`,
  )
}

/**
 * Puts a CSS Module's rules into the test document under the class names `classes` (the module's
 * default import) gives them, so a test can check what they do to visibility and computed styles.
 * Returns the function that takes them out again.
 */
export function mountCssModule(source: string, classes: Readonly<Record<string, string>>): () => void {
  let css = ''
  let buffer = ''
  let inRule = false
  for (const char of withoutComments(source)) {
    if (char === '{') {
      const prelude = buffer.trim()
      inRule = !prelude.startsWith('@')
      css += `${inRule ? mapSelectors(prelude, classes) : prelude} {`
      buffer = ''
    } else if (char === '}') {
      css += `${buffer}}\n`
      buffer = ''
      inRule = false
    } else {
      buffer += char
    }
  }
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  return () => style.remove()
}
