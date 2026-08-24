import React from "react";
import { motion } from "motion/react";
import {
  Inbox,
  Search,
  MessageSquare,
  Users,
  Bell,
  Bookmark,
  Hash,
  FileText,
} from "lucide-react";

interface EmptyStateProps {
  /** Icon to display (uses lucide icon) */
  icon?: React.ReactNode;
  /** Built-in icon variant */
  variant?:
    | "default"
    | "search"
    | "messages"
    | "notifications"
    | "feed"
    | "saves"
    | "comments"
    | "communities"
    | "hashtag";
  /** Main heading text */
  title: string;
  /** Description text */
  description?: string;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
  /** Additional className */
  className?: string;
}

const ICON_MAP: Record<
  NonNullable<EmptyStateProps["variant"]>,
  React.ReactNode
> = {
  default: <Inbox className="h-8 w-8" />,
  search: <Search className="h-8 w-8" />,
  messages: <MessageSquare className="h-8 w-8" />,
  notifications: <Bell className="h-8 w-8" />,
  feed: <FileText className="h-8 w-8" />,
  saves: <Bookmark className="h-8 w-8" />,
  comments: <MessageSquare className="h-8 w-8" />,
  communities: <Users className="h-8 w-8" />,
  hashtag: <Hash className="h-8 w-8" />,
};

/**
 * A beautifully illustrated empty state component with a glass card style.
 * Shows an icon, title, description, and optional action button.
 */
export default function EmptyState({
  icon,
  variant = "default",
  title,
  description,
  action,
  className = "",
}: EmptyStateProps) {
  const displayIcon = icon || ICON_MAP[variant] || ICON_MAP.default;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`relative flex flex-col items-center justify-center rounded-3xl border border-zinc-800/30 bg-zinc-950/40 px-6 py-14 text-center ${className}`}
    >
      {/* Glow behind icon */}
      <div className="absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_at_center,_rgba(120,120,255,0.03)_0%,_transparent_70%)] pointer-events-none" />

      <div className="relative z-10 flex flex-col items-center">
        {/* Icon container */}
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-zinc-700/50 bg-zinc-900 shadow-lg">
          <span className="text-zinc-400">{displayIcon}</span>
        </div>

        {/* Title */}
        <h3 className="text-label text-base font-semibold text-zinc-100">{title}</h3>

        {/* Description */}
        {description && (
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-zinc-500">
            {description}
          </p>
        )}

        {/* Action button */}
        {action && (
          <button
            onClick={action.onClick}
            className="mt-5 rounded-full bg-aurora border border-white/10 shadow-aurora px-5 py-2 text-xs font-bold text-white transition-all hover:opacity-90 active:scale-95 cursor-pointer"
          >
            {action.label}
          </button>
        )}
      </div>
    </motion.div>
  );
}
