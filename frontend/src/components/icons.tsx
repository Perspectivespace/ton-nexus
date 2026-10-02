/** Instrument icons — denser strokes, subtle fill for product weight */

type IconProps = { size?: number; className?: string };

export function IconHome({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4.5 10.8L12 4.5l7.5 6.3V19.2a1.3 1.3 0 0 1-1.3 1.3h-4.4v-5.2H10.2v5.2H5.8A1.3 1.3 0 0 1 4.5 19.2V10.8z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <circle cx="12" cy="12.2" r="1.6" fill="currentColor" />
    </svg>
  );
}

export function IconReactor({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="2.6" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.7" />
      <ellipse cx="12" cy="12" rx="8.2" ry="3.1" stroke="currentColor" strokeWidth="1.55" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="8.2" ry="3.1" stroke="currentColor" strokeWidth="1.55" transform="rotate(-60 12 12)" />
      <ellipse cx="12" cy="12" rx="8.2" ry="3.1" stroke="currentColor" strokeWidth="1.55" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function IconTasks({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect
        x="4"
        y="5"
        width="16"
        height="14.5"
        rx="2.2"
        stroke="currentColor"
        strokeWidth="1.7"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <path d="M8 10.2h8M8 14h5.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M8.2 5V3.8M15.8 5V3.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function IconWallet({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M3.5 9h14.2A2.3 2.3 0 0 1 20 11.3v6.4A1.8 1.8 0 0 1 18.2 19.5H5.7A2.2 2.2 0 0 1 3.5 17.3V9z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.1"
      />
      <path d="M3.5 9V7.2A1.8 1.8 0 0 1 5.3 5.4H16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="16.4" cy="14.4" r="1.35" fill="currentColor" />
    </svg>
  );
}

export function IconSpark({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 3.2v3.2M12 17.6v3.2M3.2 12h3.2M17.6 12h3.2M5.9 5.9l2.3 2.3M15.8 15.8l2.3 2.3M18.1 5.9l-2.3 2.3M8.2 15.8l-2.3 2.3"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

export function IconArrow({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M5 12h13.5M13.5 6.5 19.5 12l-6 5.5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconLevel({ size = 16, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path d="M4 18.5h4.2V10.2H4v8.3z" fill="currentColor" fillOpacity="0.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9.9 18.5H14.1V6.2H9.9v12.3z" fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.5" />
      <path d="M15.8 18.5H20v-5.2h-4.2v5.2z" fill="currentColor" fillOpacity="0.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
