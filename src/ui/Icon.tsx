// The icon set, such as it is.
//
// Inline paths rather than an icon font or a package: there are a handful of them,
// they never change, and a webfont would be a network request and a flash of
// nothing for something the size of this file. They inherit currentColor, so a
// button's own colour carries them.
//
// One line weight (2) and one grid (24) throughout. Mixing weights is what makes
// a set look assembled rather than drawn.

export type IconName =
  | 'version'
  | 'download'
  | 'list'
  | 'refresh'
  | 'save'
  | 'undo'
  | 'rules'
  | 'site'
  | 'plus'
  | 'trash'
  | 'chart'
  | 'settings'
  | 'layers'
  | 'stethoscope'
  | 'close'
  | 'copy'
  | 'external'

const PATHS: Record<IconName, string> = {
  version: 'M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6l-8-4Z',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8',
  undo: 'M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8',
  rules: 'M4 4h16v4H4zM4 12h10v4H4zM4 20h6',
  site: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18Z',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 14a1.7 1.7 0 0 0-1.6-1H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.7 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 8 3V2a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 14.9 3a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 8h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z',
  layers: 'M12 3 3 7l9 4 9-4-9-4ZM3 12l9 4 9-4M3 17l9 4 9-4',
  stethoscope: 'M6 3v6a6 6 0 0 0 12 0V3M9 3H4M15 3h5M12 15v2a4 4 0 0 0 8 0v-1M20 12a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  close: 'M18 6 6 18M6 6l12 12',
  copy: 'M9 9h12v12H9zM5 15V5a2 2 0 0 1 2-2h10',
  external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3',
}

interface Props {
  name: IconName
  className?: string
}

export function Icon({ name, className }: Props) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
