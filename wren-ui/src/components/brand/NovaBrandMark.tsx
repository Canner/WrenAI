import { useId } from 'react';

type Props = {
  size?: number;
  className?: string;
  title?: string;
};

export default function NovaBrandMark({
  size = 22,
  className,
  title = 'Nova',
}: Props) {
  const id = useId();
  const gradientId = `${id}-gradient`;
  const glowId = `${id}-glow`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label={title}
    >
      <defs>
        <linearGradient id={gradientId} x1="3" y1="2.5" x2="21" y2="21.5">
          <stop offset="0" stopColor="#6D4AFF" />
          <stop offset="0.58" stopColor="#4E88FF" />
          <stop offset="1" stopColor="#27C6B7" />
        </linearGradient>
        <radialGradient
          id={glowId}
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(8 6) rotate(42.5) scale(16.2804 12.6028)"
        >
          <stop stopColor="white" stopOpacity="0.34" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="7"
        fill={`url(#${gradientId})`}
      />
      <rect
        x="1.5"
        y="1.5"
        width="21"
        height="21"
        rx="7"
        fill={`url(#${glowId})`}
      />
      <path
        d="M6.4 15.9L10.7 7.4L15.9 11.9"
        stroke="rgba(255,255,255,0.96)"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 7.3L15.4 5.4"
        stroke="rgba(255,255,255,0.72)"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="6.2" cy="15.8" r="1.65" fill="white" />
      <circle cx="10.7" cy="7.4" r="1.55" fill="#FFD666" />
      <circle cx="15.9" cy="11.9" r="1.7" fill="#D9F7FF" />
      <circle cx="16.7" cy="5.2" r="1.2" fill="white" fillOpacity="0.88" />
    </svg>
  );
}
