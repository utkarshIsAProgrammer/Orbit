import { motion } from "motion/react";

interface TypingIndicatorProps {
  /** Name or text to show next to the dots */
  name?: string;
  /** Additional className */
  className?: string;
}

/**
 * An animated typing indicator with three bouncing dots.
 * Used in the chat view when the other user is typing.
 */
export default function TypingIndicator({
  name,
  className = "",
}: TypingIndicatorProps) {
  return (
    <div className={`flex items-center gap-2 px-1 py-1 ${className}`}>
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="h-1.5 w-1.5 rounded-full bg-zinc-400"
            animate={{
              y: [0, -4, 0],
              opacity: [0.4, 1, 0.4],
            }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              delay: i * 0.15,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
      {name && (
        <span className="text-[10px] font-medium text-zinc-500">
          {name} is typing...
        </span>
      )}
    </div>
  );
}
