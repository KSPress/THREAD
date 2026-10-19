// Shared plumbing for the `/` block menu and the `[[` Stitch picker.
import { Extension, type Editor, type Range } from '@tiptap/core'
import { ReactRenderer } from '@tiptap/react'
import Suggestion, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion'
import { PluginKey } from '@tiptap/pm/state'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  id: string
  title: string
  hint?: string
  glyph?: ReactNode
  group?: string
  color?: string
  run: (editor: Editor, range: Range) => void
}

export interface MenuHandle {
  onKeyDown: (e: KeyboardEvent) => boolean
}

export const SuggestMenu = forwardRef<MenuHandle, { items: MenuItem[]; command: (item: MenuItem) => void; title: string }>(
  function SuggestMenu({ items, command, title }, ref) {
    const [index, setIndex] = useState(0)
    const list = useRef<HTMLDivElement>(null)
    useEffect(() => setIndex(0), [items])
    useEffect(() => {
      list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' })
    }, [index])
    useImperativeHandle(ref, () => ({
      onKeyDown(e) {
        if (!items.length) return false
        if (e.key === 'ArrowDown') {
          setIndex((i) => (i + 1) % items.length)
          return true
        }
        if (e.key === 'ArrowUp') {
          setIndex((i) => (i - 1 + items.length) % items.length)
          return true
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          command(items[index])
          return true
        }
        return false
      },
    }))
    let lastGroup: string | undefined
    return (
      <div className="suggest pop" ref={list}>
        <div className="label suggest__title">[ {title} ]</div>
        {items.length === 0 && <div className="suggest__empty muted">Nothing matches</div>}
        {items.map((item, i) => {
          const header = item.group && item.group !== lastGroup ? item.group : null
          lastGroup = item.group
          return (
            <div key={item.id}>
              {header && <div className="suggest__group mono">{header}</div>}
              <button
                className={'suggest__item' + (i === index ? ' is-active' : '')}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  command(item)
                }}
              >
                <span className="suggest__glyph" style={item.color ? { background: item.color, color: '#fff' } : undefined}>
                  {item.glyph}
                </span>
                <span className="suggest__text">
                  <b>{item.title}</b>
                  {item.hint && <small>{item.hint}</small>}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    )
  },
)

/** Build a Suggestion-backed extension that renders a SuggestMenu. */
export function suggestExtension(opts: {
  name: string
  char: string
  title: string
  allowSpaces?: boolean
  items: (query: string, editor: Editor) => MenuItem[]
}) {
  const key = new PluginKey(opts.name)
  return Extension.create({
    name: opts.name,
    addProseMirrorPlugins() {
      const config: Omit<SuggestionOptions<MenuItem>, 'editor'> = {
        pluginKey: key,
        char: opts.char,
        allowSpaces: opts.allowSpaces ?? false,
        startOfLine: false,
        items: ({ query, editor }) => opts.items(query, editor),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let renderer: ReactRenderer<MenuHandle> | null = null
          const place = (p: SuggestionProps<MenuItem>) => {
            const rect = p.clientRect?.()
            const el = renderer?.element as HTMLElement | undefined
            if (!rect || !el) return
            const h = el.offsetHeight || 320
            const below = rect.bottom + 8 + h < window.innerHeight
            el.style.left = `${Math.min(rect.left, window.innerWidth - 300)}px`
            el.style.top = below ? `${rect.bottom + 8}px` : `${Math.max(8, rect.top - h - 8)}px`
          }
          return {
            onStart: (p) => {
              renderer = new ReactRenderer(SuggestMenu, {
                props: { items: p.items, command: p.command, title: opts.title },
                editor: p.editor,
              })
              const el = renderer.element as HTMLElement
              el.className = 'suggest-host'
              document.body.appendChild(el)
              requestAnimationFrame(() => place(p))
            },
            onUpdate: (p) => {
              renderer?.updateProps({ items: p.items, command: p.command, title: opts.title })
              requestAnimationFrame(() => place(p))
            },
            onKeyDown: (p) => {
              if (p.event.key === 'Escape') {
                renderer?.destroy()
                renderer?.element.remove()
                renderer = null
                return true
              }
              return renderer?.ref?.onKeyDown(p.event) ?? false
            },
            onExit: () => {
              renderer?.destroy()
              renderer?.element.remove()
              renderer = null
            },
          }
        },
      }
      return [Suggestion({ editor: this.editor, ...config })]
    },
  })
}

export function fuzzy(query: string, text: string) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 1
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  let i = 0
  for (const ch of t) if (ch === q[i]) i++
  return i === q.length ? 1 : 0
}
