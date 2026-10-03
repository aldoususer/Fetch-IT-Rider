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
      <img
        src="/rider-logo.png"
        alt=""
        width={size}
        height={size}
        className="shrink-0 object-contain"
        aria-hidden="true"
      />
      {showWordmark && (
        <span className="font-bold text-xl tracking-tight">
          Fetch<span className="text-primary">-It</span>
        </span>
      )}
    </div>
  );
}
