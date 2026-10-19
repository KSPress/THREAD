import { toICS } from '../../shared/deadlines.js'
import { allDeadlines } from './deadlines'
import { openLink } from './gcal'
import { saveFile } from './platform'
import { useStore } from './store'

/** A one-off .ics file any calendar app can import. */
export async function downloadICS() {
  const name = useStore.getState().adapter?.name ?? 'THREAD'
  const ics = toICS(allDeadlines(), { name: `THREAD — ${name}`, link: openLink })
  await saveFile(`${name} deadlines.ics`, ics)
}
