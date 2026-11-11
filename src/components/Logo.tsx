export function KittyMark({ size = 28 }: { size?: number }) {
  // A coin with two ears: Kitty's original mark.
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M6 11 L8.5 2.5 L14 8.2 Z" fill="#C8326B" />
      <path d="M26 11 L23.5 2.5 L18 8.2 Z" fill="#C8326B" />
      <circle cx="16" cy="18" r="12" fill="#C8326B" />
      <circle cx="16" cy="18" r="8.4" fill="none" stroke="#fff" strokeWidth="1.6" opacity="0.9" />
      <path d="M16 13.2v9.6M13.4 15.4c0-1.1 1.1-1.8 2.6-1.8s2.6.7 2.6 1.7c0 2.6-5.2 1.4-5.2 4.2 0 1 1.1 1.8 2.6 1.8s2.6-.7 2.6-1.8" stroke="#fff" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <KittyMark size={size} />
      <span className="display font-bold text-ink" style={{ fontSize: size * 0.86 }}>
        kitty
      </span>
    </span>
  );
}
