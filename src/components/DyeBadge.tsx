import { useStore } from '../core/store'

export function DyeBadge({ dye, small, onClick, children }: { dye: string; small?: boolean; onClick?: (e?: React.MouseEvent) => void; children?: React.ReactNode }) {
  const color = useStore((s) => s.dyeColors[dye] ?? s.dyeColor(dye))
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag className={'dye' + (small ? ' dye--sm' : '')} style={{ ['--c' as any]: color }} onClick={onClick}>
      {dye}
      {children}
    </Tag>
  )
}
