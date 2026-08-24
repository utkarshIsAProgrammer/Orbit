import { Sparkles } from "lucide-react";

interface DayOneFlairProps {
  className?: string;
}

/**
 * Day One flair — a tiny teal→gold sparkle shown beside the name of any
 * founding member (their email was on the waitlist). A visual-only perk:
 * no achievement can unlock it, so it instantly reads as "joined first".
 */
export default function DayOneFlair({ className = "" }: DayOneFlairProps) {
  return (
    <span
      title="Day One member — joined from the waitlist"
      aria-label="Day One member"
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 via-cyan-400 to-amber-400 p-[2px] shadow-[0_0_8px_rgba(45,212,191,0.45)] ${className}`}
    >
      <Sparkles
        className="h-[10px] w-[10px] text-zinc-950"
        strokeWidth={2.5}
      />
    </span>
  );
}
