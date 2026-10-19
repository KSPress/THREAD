// The Loom: home dashboard of the vault.
import { useMemo, useState } from 'react'
import { Agenda } from '../components/Agenda'
import { DyeBadge } from '../components/DyeBadge'
import { Heatmap } from '../components/Heatmap'
import { Icon } from '../components/Icon'
import { Mark } from '../components/Logo'
import { folderNote, useStore, type ThreadInfo, useDyeColor } from '../core/store'
import { excerpt } from '../core/markdown'
import { dirname } from '../core/paths'
import { PALETTES, useSettings } from '../core/settings'

function greeting() {
  const h = new Date().getHours()
  return h < 5 ? 'Late night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function HomeView() {
  const threads = useStore((s) => s.threads)
  const files = useStore((s) => s.files)
  const recent = useStore((s) => s.recent)
  const adapter = useStore((s) => s.adapter)
  const dyeFilter = useStore((s) => s.dyeFilter)
  const set = useStore((s) => s.set)
  const open = useStore((s) => s.open)
  const createThread = useStore((s) => s.createThread)
  const createProject = useStore((s) => s.createProject)
  const setView = useStore((s) => s.setView)
  const dyeColor = useDyeColor()
  const palette = useSettings((s) => s.palette)
  const [stat, setStat] = useState(0)

  const list = Object.values(threads)
  const projects = useMemo(() => {
    return Object.values(files)
      .filter((f) => f.kind === 'folder' && !f.path.includes('/'))
      .map((f) => {
        const inside = list.filter((t) => t.path.startsWith(f.path + '/'))
        const note = folderNote(f.path, threads)
        const noteThread = note ? threads[note] : undefined
        return {
          path: f.path,
          note,
          threads: inside.length,
          words: inside.reduce((s, t) => s + t.words, 0),
          summary: (noteThread?.frontmatter.summary as string) ?? (noteThread ? excerpt(noteThread.body, 90) : ''),
          dye: noteThread?.dyes.find((d) => d !== 'project'),
          mtime: Math.max(0, ...inside.map((t) => t.mtime)),
        }
      })
      // Plain storage folders (attachments, empty dirs) are not Projects.
      .filter((p) => p.note || p.threads > 0)
      .sort((a, b) => b.mtime - a.mtime)
  }, [files, threads])

  const totals = useMemo(() => {
    const dyes = new Set<string>()
    list.forEach((t) => t.dyes.forEach((d) => dyes.add(d)))
    return [
      { label: 'Words woven', value: list.reduce((s, t) => s + t.words, 0), unit: 'W', note: 'Every word across every Thread in this vault.' },
      { label: 'Threads', value: list.length, unit: '≡', note: 'Plain Markdown files you own, readable anywhere.' },
      { label: 'Stitches', value: list.reduce((s, t) => s + t.stitches.length, 0), unit: '⌗', note: 'Bidirectional links holding your world together.' },
      { label: 'Projects', value: projects.length, unit: '▣', note: 'Folders that open as their own dashboard Thread.' },
      { label: 'Dyes', value: dyes.size, unit: '◐', note: 'Tags rendered as color across the whole workspace.' },
    ]
  }, [list, projects])
  const current = totals[stat]

  const recentThreads = recent.map((p) => threads[p]).filter(Boolean).slice(0, 8)
  const filtered = dyeFilter ? list.filter((t) => t.dyes.includes(dyeFilter)) : null
  const colors = PALETTES[palette].colors

  return (
    <div className="view">
      <div className="home">
        <div className="home__hero">
          <div className="card hero-card glow">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Mark size={22} />
              <span className="label">[ The Loom · {adapter?.name} ]</span>
            </div>
            <div>
              <h1>
                {greeting()},
                <br />
                <em>weaver</em>.
              </h1>
              <p>Pick up a loose Thread, stitch a new idea into your world, or bind your chapters into a manuscript.</p>
            </div>
            <div className="hero-actions">
              <button className="btn btn--ink" onClick={() => void createThread('', 'Untitled').then(open)}>
                <Icon name="plus" size={14} /> New Thread
              </button>
              <button
                className="btn"
                onClick={async () => {
                  const name = prompt('Name your Project', 'New Project')
                  if (name) open(await createProject(name))
                }}
              >
                <Icon name="folder" size={14} /> New Project
              </button>
              <button className="btn" onClick={() => setView('desk')}>
                <Icon name="desk" size={14} /> The Desk
              </button>
              <button className="btn" onClick={() => setView('compiler')}>
                <Icon name="compiler" size={14} /> Compile
              </button>
            </div>
          </div>

          <div className="tiles impact">
            <div className="tile" style={{ display: 'flex', alignItems: 'center', padding: '22px 26px' }}>
              <span className="impact__word">
                Thread<i>.</i>
              </span>
            </div>
            <div className="tile tile--metal" />
            <div className="tile impact__stack" style={{ gridRow: 2 }}>
              <div className="tile--accent hatch" style={{ minHeight: 70 }} />
              <div className="tile--accent" style={{ padding: 18, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
                <span className="impact__num" key={stat} style={{ animation: 'fade-up 400ms var(--ease)' }}>
                  {compact(current.value)}
                </span>
                <span className="impact__unit">{current.unit}</span>
              </div>
            </div>
            <div className="tile" style={{ gridColumn: '2 / 4', gridRow: 2, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="impact__nav">
                <button onClick={() => setStat((stat + totals.length - 1) % totals.length)} aria-label="Previous stat">
                  <Icon name="left" size={14} />
                </button>
                <span>
                  vault: <b>{adapter?.name.toUpperCase()}</b>
                </span>
                <button onClick={() => setStat((stat + 1) % totals.length)} aria-label="Next stat">
                  <Icon name="right" size={14} />
                </button>
              </div>
              <div className="spacer" />
              <div className="impact__title">{current.label}</div>
              <div className="muted" style={{ fontSize: 14 }}>
                {current.note}
              </div>
            </div>
          </div>
        </div>

        <div className="home__row">
          <section className="card card--soft">
            <Agenda />
          </section>
          <section className="card card--soft">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className="label">[ Activity · days woven, in Dye colors ]</span>
            </div>
            <Heatmap />
          </section>
        </div>

        {filtered ? (
          <>
            <div className="section-head">
              <h2>Dyed</h2>
              <DyeBadge dye={dyeFilter!} />
              <span className="spacer" />
              <button className="btn btn--ghost" onClick={() => set({ dyeFilter: null })}>
                Clear
              </button>
            </div>
            <ThreadGrid threads={filtered} />
          </>
        ) : (
          <>
            <div className="section-head">
              <h2>Projects</h2>
              <span className="label">[ {String(projects.length).padStart(2, '0')} ]</span>
            </div>
            <div className="project-grid">
              {projects.map((p, i) => (
                <div
                  key={p.path}
                  className="folder-card folder-card--link"
                  style={{ ['--sky' as any]: p.dye ? dyeColor(p.dye) : colors[i % colors.length], ['--sky-rot' as any]: `${(i * 67) % 360}deg`, animation: `fade-up 520ms var(--ease) ${i * 50}ms both` }}
                  onClick={async () =>
                    open(
                      p.note ??
                        (await createThread(p.path, p.path, `# ${p.path}\n\nThe central dashboard for this Project.\n`, { type: 'project', dyes: ['project'] })),
                    )
                  }
                >
                  <div className="folder-card__sky">
                    <span className="folder-card__kicker">
                      Project
                      <br />
                      Dashboard
                    </span>
                  </div>
                  <div className="folder-card__body">
                    <div className="folder-card__tab">
                      <b>{p.path}</b>
                      <span className="muted" style={{ fontSize: 13.5, lineHeight: 1.4 }}>
                        {p.summary || (p.note ? 'An empty Project, waiting for Threads.' : 'No dashboard Thread yet — open to weave one.')}
                      </span>
                    </div>
                    <div className="folder-card__foot">
                      <span className="big-num">{String(p.threads).padStart(2, '0')}</span>
                      <span className="muted">Threads</span>
                      <span className="spacer" />
                      <b>{p.words.toLocaleString()} Words</b>
                    </div>
                  </div>
                </div>
              ))}
              <button
                className="folder-card folder-card--link"
                style={{ ['--sky' as any]: 'var(--sand)', minHeight: 260, display: 'grid', placeItems: 'center' }}
                onClick={async () => {
                  const name = prompt('Name your Project', 'New Project')
                  if (name) open(await createProject(name))
                }}
              >
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <Icon name="plus" size={28} />
                  <b>New Project</b>
                </span>
              </button>
            </div>

            {recentThreads.length > 0 && (
              <>
                <div className="section-head">
                  <h2>Recently woven</h2>
                </div>
                <ThreadGrid threads={recentThreads} />
              </>
            )}

            <div className="section-head">
              <h2>Loose Threads</h2>
              <span className="label">[ vault root ]</span>
            </div>
            <ThreadGrid threads={list.filter((t) => !dirname(t.path)).sort((a, b) => b.mtime - a.mtime)} />
          </>
        )}
      </div>
    </div>
  )
}

function ThreadGrid({ threads }: { threads: ThreadInfo[] }) {
  const open = useStore((s) => s.open)
  if (!threads.length) return <div className="empty-note" style={{ margin: '0 6px 30px' }}>Nothing here yet.</div>
  return (
    <div className="thread-grid">
      {threads.map((t, i) => (
        <button key={t.path} className="thread-tile" onClick={() => open(t.path)} style={{ animationDelay: `${i * 30}ms` }}>
          <span className="label">{dirname(t.path) || 'vault'}</span>
          <b>{t.title}</b>
          <p>{excerpt(t.body)}</p>
          <div className="thread-tile__foot">
            {t.dyes.slice(0, 3).map((d) => (
              <DyeBadge key={d} dye={d} small />
            ))}
            <span className="spacer" />
            <span className="mono muted" style={{ fontSize: 10.5 }}>
              {t.words}w
            </span>
          </div>
        </button>
      ))}
    </div>
  )
}

function compact(n: number) {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}
