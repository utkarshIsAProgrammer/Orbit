import React, { useState, useEffect } from "react";
import { User } from "lucide-react";
import { optimizeImageUrl } from "../utils/imageUrls";

interface UserAvatarProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> {
  src?: string | null;
  /** Max pixel width requested from Cloudinary (default 96). */
  size?: number;
  /** First Orbit ring — gradient halo around the avatar for Day One
   *  waitlist members (visual-only perk). */
  perkRing?: boolean;
}

export default function UserAvatar({ src, alt, className = "", size = 96, perkRing = false, ...props }: UserAvatarProps) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  // Avatars are tiny — request a downscaled, format-optimized thumbnail from
  // Cloudinary and load it eagerly so profile pics appear instantly after a
  // reload instead of trickling in at full original resolution.
  const optimizedSrc = optimizeImageUrl(src, size);

  const cleanedClass = className.replace(/\brounded\b(-\S+)?/g, "");
  const baseClass = "rounded-full object-cover shrink-0 aspect-square overflow-hidden";
  const finalClass = `${baseClass} ${cleanedClass}`.trim();

  let inner: React.ReactNode;
  if (optimizedSrc && !hasError) {
    inner = (
      <img
        src={optimizedSrc}
        alt={alt || ""}
        loading="lazy"
        decoding="async"
        // Google-hosted avatars (lh3.googleusercontent.com) refuse requests
        // carrying a Referer — they redirect to an HTML consent page, which
        // Chrome then blocks (OpaqueResponseBlocking) and the avatar never
        // loads. Stripping the referrer fixes it.
        referrerPolicy="no-referrer"
        className={`${finalClass} cursor-pointer`}
        onError={() => setHasError(true)}
        onClick={(e) => {
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent("openImagePreview", {
              detail: { url: src, variant: "avatar" },
            }),
          );
        }}
        {...props}
      />
    );
  } else {
    inner = (
      <div
        className={`${finalClass} flex items-center justify-center bg-zinc-800`}
        aria-label={alt || "User avatar"}
        {...(props as any)}
      >
        <User className="h-1/2 w-1/2 text-zinc-400" />
      </div>
    );
  }

  if (!perkRing) {
    return <>{inner}</>;
  }

  // First Orbit ring — a thin teal→cyan→gold halo wrapped around the
  // avatar. Only Day One waitlist members carry it.
  return (
    <span
      className="inline-flex shrink-0 rounded-full p-[2px]"
      title="Day One member"
      style={{
        background:
          "conic-gradient(from 210deg, #14b8a6, #22d3ee, #fbbf24, #14b8a6, #14b8a6)",
        boxShadow: "0 0 10px -2px rgba(45, 212, 191, 0.45)",
      }}
    >
      {inner}
    </span>
  );
}
