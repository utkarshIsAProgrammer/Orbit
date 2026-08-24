import React, { useEffect } from "react";
import { motion } from "motion/react";

interface SkeletonProps {
  className?: string;
  variant?: "card" | "avatar" | "text" | "circle" | "banner" | "profile-row" | "message-sent" | "message-received" | "post" | "community" | "chat-list" | "notification" | "grid";
  width?: string;
  height?: string;
  count?: number;
}

// Inject shimmer keyframes once globally (same style as App.tsx suggestions skeleton)
// Checks for App.tsx's shimmer-skeleton-style first to avoid duplicate keyframes
function useShimmerStyle() {
  useEffect(() => {
    if (document.getElementById("shimmer-skeleton-style") || document.getElementById("skeleton-shimmer-style")) {
      return;
    }
    const style = document.createElement("style");
    style.id = "skeleton-shimmer-style";
    style.textContent = `
      @keyframes shimmer {
        0% { background-position: 200% 0; opacity: 0.6; }
        50% { opacity: 1; }
        100% { background-position: -200% 0; opacity: 0.6; }
      }
      .shimmer-bg {
        background: linear-gradient(
          90deg,
          rgba(39, 39, 42, 0.6) 0%,
          rgba(63, 63, 70, 0.6) 40%,
          rgba(82, 82, 91, 0.3) 50%,
          rgba(63, 63, 70, 0.6) 60%,
          rgba(39, 39, 42, 0.6) 100%
        );
        background-size: 200% 100%;
        animation: shimmer 1.5s ease-in-out infinite;
        animation-delay: var(--shimmer-delay, 0s);
      }
    `;
    document.head.appendChild(style);
  }, []);
}

function SkeletonInner({ className = "", variant = "text", width, height }: SkeletonProps) {
  useShimmerStyle();

  const baseClass = "relative overflow-hidden rounded-2xl border border-white/5 bg-zinc-900/40 backdrop-blur-sm";
  
  const variantClasses: Record<string, string> = {
    card: "p-4 space-y-3",
    avatar: "rounded-full",
    text: "h-2.5 rounded-full",
    circle: "rounded-full",
    banner: "h-36 rounded-3xl",
    "profile-row": "flex items-center gap-3 p-3",
    "message-sent": "ml-auto max-w-[75%]",
    "message-received": "mr-auto max-w-[75%]",
    "post": "p-4 space-y-3",
    "community": "p-4 space-y-2",
    "chat-list": "flex items-center gap-3 p-3",
    "notification": "p-3 space-y-1",
    "grid": "p-4",
  };

  const sizeStyles: React.CSSProperties = {};
  if (width) sizeStyles.width = width;
  if (height) sizeStyles.height = height;

  return (
    <motion.div
      className={`${baseClass} ${variantClasses[variant] || variantClasses.text} ${className}`}
      style={sizeStyles}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Glass shimmer overlay */}
      <div className="absolute inset-0 opacity-30 pointer-events-none bg-[length:200%_100%] bg-linear-to-r from-transparent via-white/5 to-transparent animate-[shimmer_2s_ease-in-out_infinite]" />
      <div className="relative z-10" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
        {variant === "card" && (
          <div className="space-y-2.5">
            {/* Author avatar + name row */}
            <div className="flex items-center gap-3" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
              <div className="h-9 w-9 rounded-full shimmer-bg shrink-0" />
              <div className="space-y-1.5 flex-1">
                <div className="h-2.5 w-1/3 rounded shimmer-bg" />
                <div className="h-2 w-1/5 rounded shimmer-bg" />
              </div>
            </div>
            {/* Title */}
            <div className="h-3.5 w-3/4 rounded shimmer-bg" style={{ '--shimmer-delay': '0.08s' } as React.CSSProperties} />
            {/* Content lines */}
            <div className="space-y-1.5" style={{ '--shimmer-delay': '0.15s' } as React.CSSProperties}>
              <div className="h-2.5 w-full rounded shimmer-bg" />
              <div className="h-2.5 w-2/3 rounded shimmer-bg" />
            </div>
            {/* Action buttons rail */}
            <div className="flex items-center justify-between pt-2 border-t border-zinc-800/30" style={{ '--shimmer-delay': '0.22s' } as React.CSSProperties}>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-2.5 w-8 rounded shimmer-bg" />
              ))}
            </div>
          </div>
        )}
        {variant === "profile-row" && (
          <div className="flex items-center gap-3" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
            <div className="h-9 w-9 rounded-full shimmer-bg shrink-0" />
            <div className="space-y-1.5 flex-1">
              <div className="h-2.5 w-1/3 rounded shimmer-bg" />
              <div className="h-2 w-1/5 rounded shimmer-bg" />
            </div>
          </div>
        )}
        {variant === "message-sent" && (
          <div className="flex flex-col items-end gap-1.5" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
            <div className="rounded-2xl rounded-tr-none bg-zinc-800/60 px-3 py-2 w-4/5">
              <div className="h-2 w-full rounded shimmer-bg" />
              <div className="h-2 w-2/3 rounded shimmer-bg mt-1.5" />
            </div>
          </div>
        )}
        {variant === "message-received" && (
          <div className="flex items-start gap-2.5" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
            <div className="h-7 w-7 rounded-full shimmer-bg shrink-0 mt-1" />
            <div className="rounded-2xl rounded-tl-none bg-zinc-900/60 px-3 py-2 w-4/5">
              <div className="h-2 w-full rounded shimmer-bg" />
              <div className="h-2 w-1/2 rounded shimmer-bg mt-1.5" />
            </div>
          </div>
        )}
        {variant === "post" && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-2" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
              <div className="h-8 w-8 rounded-full shimmer-bg shrink-0" />
              <div className="space-y-1">
                <div className="h-2.5 w-20 rounded shimmer-bg" />
                <div className="h-2 w-14 rounded shimmer-bg" />
              </div>
            </div>
            <div className="h-3 w-3/4 rounded shimmer-bg" style={{ '--shimmer-delay': '0.08s' } as React.CSSProperties} />
            <div className="space-y-1.5" style={{ '--shimmer-delay': '0.15s' } as React.CSSProperties}>
              <div className="h-2.5 w-full rounded shimmer-bg" />
              <div className="h-2.5 w-2/3 rounded shimmer-bg" />
              <div className="h-2.5 w-4/5 rounded shimmer-bg" />
            </div>
          </div>
        )}
        {variant === "community" && (
          <div className="space-y-2">
            <div className="flex items-center gap-3" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
              <div className="h-10 w-10 rounded-xl shimmer-bg shrink-0" />
              <div className="space-y-1 flex-1">
                <div className="h-3 w-1/2 rounded shimmer-bg" />
                <div className="h-2 w-1/3 rounded shimmer-bg" />
              </div>
            </div>
          </div>
        )}
        {variant === "chat-list" && (
          <div className="flex items-center gap-3" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
            <div className="h-10 w-10 rounded-full shimmer-bg shrink-0" />
            <div className="space-y-1 flex-1">
              <div className="h-2.5 w-1/4 rounded shimmer-bg" />
              <div className="h-2 w-2/3 rounded shimmer-bg" />
            </div>
          </div>
        )}
        {variant === "notification" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2.5" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
              <div className="h-8 w-8 rounded-full shimmer-bg shrink-0" />
              <div className="space-y-1 flex-1">
                <div className="h-2 w-3/4 rounded shimmer-bg" />
                <div className="h-2 w-1/3 rounded shimmer-bg" />
              </div>
            </div>
          </div>
        )}
        {variant === "grid" && (
          <div className="grid grid-cols-2 gap-2" style={{ '--shimmer-delay': '0s' } as React.CSSProperties}>
            <div className="aspect-square rounded-xl shimmer-bg" />
            <div className="aspect-square rounded-xl shimmer-bg" />
            <div className="aspect-square rounded-xl shimmer-bg" />
            <div className="aspect-square rounded-xl shimmer-bg" />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default React.memo(function Skeleton(props: SkeletonProps) {
  const { count = 1, ...rest } = props;
  
  if (count <= 1) {
    return <SkeletonInner {...rest} />;
  }

  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonInner key={i} {...rest} />
      ))}
    </div>
  );
});
