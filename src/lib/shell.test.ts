import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { COMPACT_SHELL } from './shell'

/**
 * The signed-in shell at every width.
 *
 * Wide, the module nav is the sidebar. Narrow, the sidebar goes, and a top bar
 * with a menu button takes its place. More than one stylesheet switches on
 * that breakpoint, and they cannot share it through a token — a media query
 * does not read custom properties — so each writes it out. If two ever
 * disagree, some band of widths gets both navs, or neither: somebody on a
 * phone with no way to reach another module.
 *
 * The page gutter is the other half. Every module insets its header and body
 * by --page-gutter, which narrows on a phone. A module that writes the old
 * 28px out by hand keeps it on a 375px screen, and nothing else would notice.
 */

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(root + path, 'utf8')
const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Each `@media` block in a stylesheet: its query, and what is inside it. */
function mediaBlocks(css: string): { query: string; body: string }[] {
  const source = withoutComments(css)
  return [...source.matchAll(/@media\s+([^{]+?)\s*\{/g)].map((match) => {
    const start = match.index + match[0].length
    let depth = 1
    let end = start
    while (depth > 0 && end < source.length) {
      if (source[end] === '{') depth++
      if (source[end] === '}') depth--
      end++
    }
    return { query: match[1], body: source.slice(start, end - 1) }
  })
}

const SWITCHES = ['src/app/(app)/shell.module.css', 'src/components/Sidebar.module.css']

describe('the shell breakpoint', () => {
  it.each(SWITCHES)('is where %s switches layout', (file) => {
    const queries = mediaBlocks(read(file)).map((block) => block.query)

    expect(queries).toContain(COMPACT_SHELL)
  })

  it.each(SWITCHES)('is the only width %s switches at', (file) => {
    const widths = mediaBlocks(read(file))
      .map((block) => block.query)
      .filter((query) => query.includes('width'))

    expect(new Set(widths)).toEqual(new Set([COMPACT_SHELL]))
  })
})

describe('the page gutter', () => {
  const tokens = read('src/styles/tokens.css')

  it('is 28px on a wide screen, as the design handoff has it', () => {
    const rootBlock = withoutComments(tokens).match(/:root\s*\{([^}]*)\}/)?.[1] ?? ''

    expect(rootBlock).toMatch(/--page-gutter:\s*28px;/)
  })

  it('narrows to 16px at phone width', () => {
    const phone = mediaBlocks(tokens).find((block) => block.query === '(max-width: 599px)')

    expect(phone?.body).toMatch(/:root\s*\{[^}]*--page-gutter:\s*16px;[^}]*\}/)
  })

  /** Only the horizontal half of a padding declaration is the gutter. */
  function horizontal(property: string, value: string): string[] {
    const parts = value.trim().split(/\s+/)
    if (property !== 'padding') return parts
    const [top, right = top, , left = right] = parts
    return [right, left]
  }

  it('is where every module takes its side inset from, rather than a 28px of its own', () => {
    const dir = root + 'src/app/(app)/'
    const sheets = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter((path) =>
      path.endsWith('.module.css'),
    )
    expect(sheets.length).toBeGreaterThan(0)

    const offenders = sheets.flatMap((path) => {
      const css = withoutComments(read('src/app/(app)/' + path))
      const found = css.matchAll(
        /(padding(?:-inline(?:-start|-end)?|-left|-right)?)\s*:\s*([^;]+);/g,
      )
      return [...found]
        .filter(([, property, value]) => horizontal(property, value).includes('28px'))
        .map(([declaration]) => `${path}: ${declaration} — use var(--page-gutter)`)
    })

    expect(offenders).toEqual([])
  })
})
