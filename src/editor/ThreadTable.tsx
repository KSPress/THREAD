// The Table block: a typed, relational spreadsheet living inside a Thread.
import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react'
import { useMemo, useState } from 'react'
import { useStore, useDyeColor } from '../core/store'
import { COLUMN_TYPES, emptyTable, linkTargets, parseTableBlock, serializeTable, uid, type Column, type ColumnType, type TableData } from '../core/table'
import { Icon } from '../components/Icon'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    threadTable: { insertThreadTable: () => ReturnType }
  }
}

export const ThreadTable = Node.create({
  name: 'threadTable',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      data: {
        default: null,
        parseHTML: (el) => JSON.parse((el as HTMLElement).dataset.table ?? 'null'),
        renderHTML: (attrs) => ({ 'data-table': JSON.stringify(attrs.data) }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-thread-table]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-thread-table': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableView)
  },

  addCommands() {
    return {
      insertThreadTable:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { data: emptyTable() } }),
    }
  },

  markdownTokenizer: {
    name: 'threadTable',
    level: 'block',
    start: (src: string) => src.indexOf('<!-- thread-table'),
    tokenize(src: string) {
      const parsed = parseTableBlock(src)
      if (!parsed) return undefined
      return { type: 'threadTable', raw: parsed.raw, data: parsed.data }
    },
  },
  parseMarkdown(token: any) {
    return { type: 'threadTable', attrs: { data: token.data } }
  },
  renderMarkdown(node: any) {
    return serializeTable(node.attrs.data ?? emptyTable())
  },
})

function TableView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const data: TableData = node.attrs.data ?? emptyTable()
  const [menu, setMenu] = useState<string | null>(null)
  const threads = useStore((s) => s.threads)
  const names = useMemo(() => Object.values(threads).map((t) => t.name).sort(), [threads])
  const dyes = useMemo(() => {
    const set = new Set<string>()
    Object.values(threads).forEach((t) => t.dyes.forEach((d) => set.add(d)))
    data.rows.forEach((r) => data.columns.forEach((c) => c.type === 'select' && r.cells[c.id] && set.add(r.cells[c.id])))
    return [...set].sort()
  }, [threads, data])
  const listId = useMemo(() => uid('dl'), [])

  const commit = (next: TableData) => updateAttributes({ data: next })
  const setCell = (rowId: string, colId: string, value: string) =>
    commit({ ...data, rows: data.rows.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [colId]: value } } : r)) })
  const setColumn = (id: string, patch: Partial<Column>) =>
    commit({ ...data, columns: data.columns.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
  const addRow = () => commit({ ...data, rows: [...data.rows, { id: uid(), cells: {} }] })
  const addColumn = () =>
    commit({ ...data, columns: [...data.columns, { id: uid('c'), name: `Column ${data.columns.length + 1}`, type: 'text' }] })
  const removeRow = (id: string) => commit({ ...data, rows: data.rows.filter((r) => r.id !== id) })
  const removeColumn = (id: string) => {
    setMenu(null)
    commit({ ...data, columns: data.columns.filter((c) => c.id !== id) })
  }
  const sortBy = (col: Column, dir: 1 | -1) => {
    setMenu(null)
    const val = (v: string) => (col.type === 'number' ? parseFloat(v) || 0 : v.toLowerCase())
    const rows = [...data.rows].sort((a, b) => {
      const x = val(a.cells[col.id] ?? '')
      const y = val(b.cells[col.id] ?? '')
      return x < y ? -dir : x > y ? dir : 0
    })
    commit({ ...data, rows })
  }

  return (
    <NodeViewWrapper className={'tt' + (selected ? ' is-selected' : '')} data-drag-handle="">
      <div className="tt__bar" contentEditable={false}>
        <span className="label">[ TABLE ]</span>
        <span className="tt__meta mono">
          {data.rows.length} rows · {data.columns.length} cols
        </span>
        <span className="spacer" />
        <button className="chip-btn" onClick={addColumn}>
          <Icon name="plus" size={12} /> Column
        </button>
      </div>
      <div className="tt__scroll" contentEditable={false}>
        <table>
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c.id} className={`tt__th tt--${c.type}`}>
                  <div className="tt__thin">
                    <button className="tt__type" title="Column type & options" onClick={() => setMenu(menu === c.id ? null : c.id)}>
                      {COLUMN_TYPES.find((t) => t.type === c.type)?.glyph}
                    </button>
                    <input className="tt__name" value={c.name} onChange={(e) => setColumn(c.id, { name: e.target.value })} />
                  </div>
                  {menu === c.id && (
                    <div className="pop tt__menu" onMouseLeave={() => setMenu(null)}>
                      <div className="label">[ TYPE ]</div>
                      <div className="tt__types">
                        {COLUMN_TYPES.map((t) => (
                          <button
                            key={t.type}
                            className={'key' + (t.type === c.type ? ' is-on' : '')}
                            onClick={() => setColumn(c.id, { type: t.type as ColumnType })}
                          >
                            <b>{t.glyph}</b>
                            {t.label}
                          </button>
                        ))}
                      </div>
                      <div className="pop__row">
                        <button onClick={() => sortBy(c, 1)}>Sort ↑</button>
                        <button onClick={() => sortBy(c, -1)}>Sort ↓</button>
                        <button className="danger" onClick={() => removeColumn(c.id)}>
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </th>
              ))}
              <th className="tt__add" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                {data.columns.map((c) => (
                  <td key={c.id} className={`tt--${c.type}`}>
                    <Cell col={c} value={r.cells[c.id] ?? ''} onChange={(v) => setCell(r.id, c.id, v)} listId={listId} />
                  </td>
                ))}
                <td className="tt__add">
                  <button className="tt__x" title="Delete row" onClick={() => removeRow(r.id)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {data.columns.some((c) => c.type === 'number') && (
            <tfoot>
              <tr>
                {data.columns.map((c) => (
                  <td key={c.id} className="mono">
                    {c.type === 'number'
                      ? `Σ ${data.rows.reduce((s, r) => s + (parseFloat(r.cells[c.id] ?? '') || 0), 0).toLocaleString()}`
                      : ''}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        <datalist id={listId + 'n'}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
        <datalist id={listId + 'd'}>
          {dyes.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <button className="tt__newrow" contentEditable={false} onClick={addRow}>
        <Icon name="plus" size={12} /> New row
      </button>
    </NodeViewWrapper>
  )
}

function Cell({ col, value, onChange, listId }: { col: Column; value: string; onChange: (v: string) => void; listId: string }) {
  const openStitch = useStore((s) => s.openStitch)
  const dyeColor = useDyeColor()
  const resolve = useStore((s) => s.resolve)
  const [draft, setDraft] = useState('')

  switch (col.type) {
    case 'checkbox': {
      const on = /^\[x\]$/i.test(value.trim())
      return (
        <button className={'toggle' + (on ? ' is-on' : '')} onClick={() => onChange(on ? '[ ]' : '[x]')} aria-pressed={on}>
          <span />
        </button>
      )
    }
    case 'number':
      return <input className="tt__in mono" inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} />
    case 'date':
      return <input className="tt__in mono" type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    case 'select':
      return (
        <div className="tt__sel">
          {value && <span className="dye-dot" style={{ background: dyeColor(value) }} />}
          <input className="tt__in" list={listId + 'd'} value={value} onChange={(e) => onChange(e.target.value)} />
        </div>
      )
    case 'link': {
      const targets = linkTargets(value)
      const add = () => {
        const t = draft.trim()
        if (!t) return
        onChange([...targets, t].map((x) => `[[${x}]]`).join(', '))
        setDraft('')
      }
      return (
        <div className="tt__links">
          {targets.map((t) => (
            <span key={t} className={'stitch' + (resolve(t) ? '' : ' stitch--loose')} onClick={() => openStitch(t)}>
              <span className="stitch__glyph">⌗</span>
              {t}
              <button
                className="tt__unlink"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(targets.filter((x) => x !== t).map((x) => `[[${x}]]`).join(', '))
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="tt__in tt__linkin"
            list={listId + 'n'}
            placeholder="+"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            onBlur={add}
          />
        </div>
      )
    }
    default:
      return <input className="tt__in" value={value} onChange={(e) => onChange(e.target.value)} />
  }
}
