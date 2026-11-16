import type { CSSProperties } from 'react'
const paths = {
  mic: <><rect x="8" y="2" width="8" height="13" rx="4" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  activity: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
  settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="16" cy="17" r="3" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  down: <path d="M12 4v16m-6-6 6 6 6-6" />,
  up: <path d="M12 20V4m-6 6 6-6 6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  chart: <><path d="M4 4v16h16M8 16v-4m5 4V8m5 8V5" /></>,
  wallet: <><path d="M20 7H5a2 2 0 0 1 0-4h13v4M4 7v13h16V7" /><path d="M20 11h-5v5h5" /></>,
  leaf: <><path d="M5 19C-1 5 12 2 21 3c1 13-6 20-16 16ZM5 19l9-10" /></>,
} satisfies Record<string, React.ReactNode>
export default function Icon({ name, size = 20, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>
}
