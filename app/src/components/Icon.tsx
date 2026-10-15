/** 24×24 line icons, 1.6 stroke — the only iconography in the app. */
export const ICONS = {
  dash: 'M3.5 3.5h7v8h-7zM13.5 3.5h7v5h-7zM13.5 11.5h7v9h-7zM3.5 14.5h7v6h-7z',
  map: 'M9 4.5 3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5l-6-2zM9 4.5v13M15 6.5v13',
  reports: 'M6.5 3.5H14l4 4v13H6.5zM14 3.5v4h4M9.5 12h5M9.5 15.5h5',
  network: 'M12 14.7V21M9 21h6M8.1 9.6a5.5 5.5 0 0 1 7.8 0M5.3 6.8a9.5 9.5 0 0 1 13.4 0M12 12.3a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 1 0 0-2.4z',
  gateways: 'M4 13.5h16v6H4zM7.5 16.5h.01M11 16.5h.01M12 13.5V9.5M8.8 7a4.5 4.5 0 0 1 6.4 0',
  sites: 'M12 21c-3.5-3.2-6.5-6.9-6.5-10.5a6.5 6.5 0 0 1 13 0c0 3.6-3 7.3-6.5 10.5zM12 8a2.5 2.5 0 1 0 0 5 2.5 2.5 0 1 0 0-5z',
  domestic: 'M3.5 11 12 4l8.5 7M5.5 9.5V20h13V9.5M10 20v-5.5h4V20',
  business: 'M4.5 20.5V4.5h9v16M13.5 9.5h6v11M3 20.5h18M7.5 8h3M7.5 11.5h3M7.5 15h3M16 13h1M16 16.5h1',
  gov: 'M3 20.5h18M12 3.5l8 4.5H4zM4.5 17.5h15M6.5 10v7.5M10 10v7.5M14 10v7.5M17.5 10v7.5',
  meters: 'M4.6 17.5a8.5 8.5 0 1 1 14.8 0M12 13.4l3.2-3.6M12 12.2a1.2 1.2 0 1 0 0 2.4 1.2 1.2 0 1 0 0-2.4z',
  bulk: 'M12 3.5c3 3.6 6 7.3 6 10.5a6 6 0 0 1-12 0c0-3.2 3-6.9 6-10.5z',
  mdm: 'M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4',
  vee: 'M12 3.5 5 6v5.5c0 4.2 3 7.8 7 9 4-1.2 7-4.8 7-9V6zM9 12l2.2 2.2 3.8-4',
  billing: 'M6 3.5h12v17l-2-1.3-2 1.3-2-1.3-2 1.3-2-1.3-2 1.3zM9 8h6M9 11.5h6M9 15h3.5',
  operations: 'M14 6.5a4 4 0 0 0 5.2 5.2L11 20a2.1 2.1 0 0 1-3-3l8.3-8.2A4 4 0 0 1 14 6.5zM14 6.5l2.5-2.5 3 1-.8 2.7',
  portal: 'M3.5 4.5h17V16h-17zM8.5 20h7M12 16v4',
  settings: 'M20 5h-6M10 5H4M14 3v4M20 12h-8M8 12H4M8 10v4M20 19h-4M12 19H4M16 17v4',
  search: 'M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13zM20 20l-4.4-4.4',
  refresh: 'M19.5 11A7.5 7.5 0 0 0 6.2 7.2L4.5 9M4.5 4.5V9H9M4.5 13a7.5 7.5 0 0 0 13.3 3.8l1.7-1.8M19.5 19.5V15H15',
  zoomIn: 'M12 5v14M5 12h14',
  zoomOut: 'M5 12h14',
  locate: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 7a5 5 0 1 0 0 10 5 5 0 1 0 0-10z',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  pin: 'M9 4.5h6M10 4.5v5.2L7.5 13h9L14 9.7V4.5M12 13v6.5',
  signOut: 'M14.5 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4M10 16.5 5.5 12 10 7.5M5.5 12H15',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  select: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M11 4h2M11 20h2M4 11v2M20 11v2',
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      style={{ flex: 'none', display: 'block', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}
    >
      <path d={ICONS[name]} />
    </svg>
  );
}
