import type * as Y from 'yjs'

export const TEXT_KEY: 'md'
export function hash32(str: string): number
export function baselineUpdate(path: string, content: string): Uint8Array
export function applyTextDiff(ytext: Y.Text, next: string): boolean
export function toBase64(bytes: Uint8Array): string
export function fromBase64(str: string): Uint8Array
