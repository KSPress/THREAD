// The Find & Replace bar (Ctrl+F / Ctrl+H) shared by Cords and Threads.
import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { findKey } from './find'

export function FindBar({ editor, replace: startReplace, onClose }: { editor: Editor; replace?: boolean; onClose: () => void }) {
  const [query, setQuery] = useState(() => {
    const { from, to } = editor.state.selection
    const sel = editor.state.doc.textBetween(from, to, ' ')
    return sel.length < 80 ? sel : ''
  })
  const [replacement, setReplacement] = useState('')
  const [showReplace, setShowReplace] = useState(!!startReplace)
  const [caseSensitive, setCase] = useState(false)
  const [wholeWord, setWhole] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const f = useEditorState({ editor, selector: ({ editor: e }) => findKey.getState(e.state) })

  useEffect(() => {
    editor.commands.setFind({ query, caseSensitive, wholeWord })
  }, [query, caseSensitive, wholeWord])
  useEffect(() => {
    input.current?.select()
    return () => {
      if (!editor.isDestroyed) editor.commands.clearFind()
    }
  }, [])
  useEffect(() => setShowReplace((v) => v || !!startReplace), [startReplace])

  const count = f?.matches.length ?? 0
  return (
    <div className="findbar" role="search" onKeyDown={(e) => e.key === 'Escape' && (e.preventDefault(), onClose(), editor.commands.focus())}>
      <button className="icon-btn" title={showReplace ? 'Hide replace' : 'Replace (Ctrl+H)'} onClick={() => setShowReplace(!showReplace)}>
        <span className={'findbar__twist' + (showReplace ? ' is-open' : '')}>
          <Icon name="chevron" size={13} />
        </span>
      </button>
      <div className="findbar__fields">
        <div className="findbar__row">
          <input
            ref={input}
            className="input"
            placeholder="Find"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (e.shiftKey) editor.commands.findPrev()
                else editor.commands.findNext()
              }
            }}
          />
          <span className="findbar__count mono">{query ? (count ? `${(f?.index ?? 0) + 1} of ${count}` : 'No results') : ''}</span>
          <button className={'chip-btn' + (caseSensitive ? ' is-on' : '')} title="Match case" onClick={() => setCase(!caseSensitive)}>
            Aa
          </button>
          <button className={'chip-btn' + (wholeWord ? ' is-on' : '')} title="Whole words only" onClick={() => setWhole(!wholeWord)}>
            ab|
          </button>
          <button className="icon-btn" title="Previous (Shift+Enter)" disabled={!count} onClick={() => editor.commands.findPrev()}>
            <span className="findbar__up">
              <Icon name="chevron" size={13} />
            </span>
          </button>
          <button className="icon-btn" title="Next (Enter)" disabled={!count} onClick={() => editor.commands.findNext()}>
            <span className="findbar__down">
              <Icon name="chevron" size={13} />
            </span>
          </button>
        </div>
        {showReplace && (
          <div className="findbar__row">
            <input
              className="input"
              placeholder="Replace with"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  editor.commands.replaceCurrent(replacement)
                }
              }}
            />
            <button className="chip-btn" disabled={!count} onClick={() => editor.commands.replaceCurrent(replacement)}>
              Replace
            </button>
            <button className="chip-btn" disabled={!count} onClick={() => editor.commands.replaceAll(replacement)}>
              Replace all
            </button>
          </div>
        )}
      </div>
      <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}
