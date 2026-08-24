import React, { useState, useRef, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { optimizeImageUrl } from "../utils/imageUrls";

interface ImageCarouselProps {
  images: { url: string; public_id?: string; alt?: string }[];
  className?: string;
  onImageClick?: (url: string) => void;
  onImageLoad?: () => void;
}

export default function ImageCarousel({
  images,
  className = "",
  onImageClick,
  onImageLoad,
}: ImageCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Minimum swipe distance (px)
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    // Stop propagation so the post card's swipe-to-like/repost handler doesn't fire
    e.stopPropagation();
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    e.stopPropagation();
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = useCallback((e?: React.TouchEvent) => {
    if (e) e.stopPropagation();
    if (touchStart === null || touchEnd === null) return;
    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && currentIndex < images.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
    if (isRightSwipe && currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [touchStart, touchEnd, currentIndex, images.length]);

  const goTo = (index: number) => {
    setCurrentIndex(index);
  };

  const goPrev = () => {
    if (currentIndex > 0) setCurrentIndex((prev) => prev - 1);
  };

  const goNext = () => {
    if (currentIndex < images.length - 1) setCurrentIndex((prev) => prev + 1);
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "ArrowRight") goNext();
    };
    const el = containerRef.current;
    el?.addEventListener("keydown", handleKeyDown as EventListener);
    return () => el?.removeEventListener("keydown", handleKeyDown as EventListener);
  }, [currentIndex, images.length]);

  if (!images || images.length === 0) return null;

  const showArrows = images.length > 1;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      className={`relative overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-950/20 select-none [touch-action:pan-y_pinch-zoom] ${className}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Image track */}
      <div
        className="flex transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {images.map((img, idx) => (
          <div key={idx} className="w-full shrink-0">
            <img
              loading="lazy"
              decoding="async"
              src={optimizeImageUrl(img.url, 1000)}
              alt={img.alt || "post image"}
              onLoad={onImageLoad}
              onClick={() => onImageClick?.(img.url)}
              className={`w-full h-auto max-h-200 transition-transform duration-500 ${
                onImageClick ? "cursor-pointer" : ""
              }`}
            />
          </div>
        ))}
      </div>

      {/* Desktop arrow buttons */}
      {showArrows && (
        <>
          {currentIndex > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); goPrev(); }}
              className="absolute left-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition-all opacity-0 group-hover/image:opacity-100 hidden md:flex cursor-pointer"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          {currentIndex < images.length - 1 && (
            <button
              onClick={(e) => { e.stopPropagation(); goNext(); }}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm hover:bg-black/80 transition-all opacity-0 group-hover/image:opacity-100 hidden md:flex cursor-pointer"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </>
      )}

      {/* Dots indicator */}
      {showArrows && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
          {images.map((_, idx) => (
            <button
              key={idx}
              onClick={(e) => { e.stopPropagation(); goTo(idx); }}
              className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${
                idx === currentIndex
                  ? "w-5 bg-white"
                  : "w-1.5 bg-white/50 hover:bg-white/80"
              }`}
              aria-label={`Go to image ${idx + 1}`}
            />
          ))}
        </div>
      )}

      {/* Counter badge for many images */}
      {showArrows && (
        <div className="absolute top-3 right-3 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-0.5 text-[11px] font-bold text-white/90 hidden md:block">
          {currentIndex + 1} / {images.length}
        </div>
      )}
    </div>
  );
}
