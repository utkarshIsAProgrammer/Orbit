import { motion } from "motion/react";

interface SplitTextProps {
  text: string;
  className?: string;
  delay?: number; // Base delay in seconds
  staggerDelay?: number; // Delay between characters in seconds
}

export default function SplitText({ text, className = "", delay = 0, staggerDelay = 0.05 }: SplitTextProps) {
  const letters = text.split("");

  return (
    <span className={`inline-flex flex-wrap items-center justify-center ${className}`}>
      {letters.map((char, index) => (
        <motion.span
          key={index}
          initial={{ opacity: 0, y: 40, rotateX: -60, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, rotateX: 0, filter: "blur(0px)" }}
          transition={{
            type: "spring",
            stiffness: 140,
            damping: 15,
            delay: delay + index * staggerDelay,
          }}
          whileHover={{
            scale: 1.15,
            y: -8,
            color: "#f59e0b", // Gold shimmer accent on hover
            transition: { duration: 0.15 }
          }}
          className="inline-block select-none origin-bottom cursor-default pr-[0.05em] font-decorative"
          style={{ transformStyle: "preserve-3d" }}
        >
          {char === " " ? "\u00A0" : char}
        </motion.span>
      ))}
    </span>
  );
}
