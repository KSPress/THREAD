// Shared between Satellites (the app) and the Host (the Loom).
//
// Every Thread is a Y.Doc holding a single Y.Text named "md": the literal
// markdown file. Edits are applied as minimal splices so concurrent changes
// from different devices merge character-by-character instead of overwriting.
import * as Y from 'yjs'

export const TEXT_KEY = 'md'

/** FNV-1a 32-bit hash, used to derive deterministic Yjs client ids. */
export function hash32(str) {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * The baseline update for a file that has never been tracked before.
 *
 * It is written with a client id derived from (path, content), so two devices
 * that independently start tracking the same file with the same content produce
 * byte-identical structs that Yjs de-duplicates instead of doubling the text.
 */
export function baselineUpdate(path, content) {
  const doc = new Y.Doc()
  // Client ids must be 53-bit safe integers; keep it well away from random ids.
  doc.clientID = hash32(path + '\u0000' + content) + 1
  doc.getText(TEXT_KEY).insert(0, content)
  const update = Y.encodeStateAsUpdate(doc)
  doc.destroy()
  return update
}

/**
 * Splice `next` into the Y.Text, touching only the changed middle section.
 * Returns true when anything changed.
 */
export function applyTextDiff(ytext, next) {
  const prev = ytext.toString()
  if (prev === next) return false
  let start = 0
  const minLen = Math.min(prev.length, next.length)
  while (start < minLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
    endPrev--
    endNext--
  }
  // Never split a surrogate pair.
  if (start > 0 && isHighSurrogate(prev.charCodeAt(start - 1))) start--
  if (endPrev < prev.length && isLowSurrogate(prev.charCodeAt(endPrev))) {
    endPrev++
    endNext++
  }
  ytext.doc.transact(() => {
    if (endPrev > start) ytext.delete(start, endPrev - start)
    if (endNext > start) ytext.insert(start, next.slice(start, endNext))
  })
  return true
}

function isHighSurrogate(c) {
  return c >= 0xd800 && c <= 0xdbff
}
function isLowSurrogate(c) {
  return c >= 0xdc00 && c <= 0xdfff
}

export function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromBase64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'))
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
