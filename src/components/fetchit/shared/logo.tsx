// Brand logo + wordmark for Fetch-It.

import { cn } from "@/lib/utils";

export function FetchItLogo({
  className,
  showWordmark = true,
  size = 40,
}: {
  className?: string;
  showWordmark?: boolean;
  size?: number;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect width="64" height="64" rx="14" fill="var(--primary)" />
        {/* stylised parcel + arrow inside */}
        <path
          d="M16 22 L32 14 L48 22 L48 42 L32 50 L16 42 Z"
          fill="var(--primary-foreground)"
          opacity="0.95"
        />
        <path
          d="M32 14 L48 22 L32 30 L16 22 Z"
          fill="var(--primary-foreground)"
          opacity="0.55"
        />
        <path
          d="M28 38 L36 38 L36 30 L40 30 L32 22 L24 30 L28 30 Z"
          fill="var(--primary)"
        />
      </svg>
      {showWordmark && (
        <span className="font-bold text-xl tracking-tight">
          Fetch<span className="text-primary">-It</span>
        </span>
      )}
    </div>
  );
}
