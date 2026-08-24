interface CharCounterProps {
  current: number;
  max: number;
  className?: string;
}

export default function CharCounter({ current, max, className = "" }: CharCounterProps) {
  const ratio = max > 0 ? current / max : 0;
  let color = "text-zinc-500";
  if (ratio > 0.9) {
    color = "text-red-400";
  } else if (ratio > 0.75) {
    color = "text-yellow-400";
  }

  return (
    <span className={`text-[11px] font-mono font-medium transition-colors duration-200 ${color} ${className}`}>
      {current}/{max}
    </span>
  );
}
