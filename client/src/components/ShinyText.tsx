interface ShinyTextProps {
  text: string;
  disabled?: boolean;
  speed?: number; // Shimmer cycle speed in seconds
  className?: string;
}

export default function ShinyText({ text, disabled = false, speed = 4, className = "" }: ShinyTextProps) {
  const animationStyle = disabled
    ? {}
    : {
        backgroundSize: "200% auto",
        animation: `shiny-shimmer ${speed}s linear infinite`,
      };

  return (
    <span			className={`inline-block text-transparent bg-clip-text bg-gradient-to-r from-neutral-100 via-violet-300 to-neutral-200 dark:from-zinc-300 dark:via-violet-200 dark:to-zinc-400 font-medium ${className}`}
      style={animationStyle}
    >
      {text}
      <style>{`
        @keyframes shiny-shimmer {
          0% {
            background-position: -200% center;
          }
          100% {
            background-position: 200% center;
          }
        }
      `}</style>
    </span>
  );
}
