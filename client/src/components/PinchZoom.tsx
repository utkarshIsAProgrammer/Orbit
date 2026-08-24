import React, { useRef, useCallback, useState } from "react";

interface PinchZoomProps {
  children: React.ReactNode;
  className?: string;
  maxZoom?: number;
  minZoom?: number;
}

/**
 * Wrapper component that enables pinch-to-zoom gestures on its children.
 * Uses CSS transform for smooth zooming with touch event handling.
 */
export default function PinchZoom({
  children,
  className = "",
  maxZoom = 4,
  minZoom = 1,
}: PinchZoomProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isZoomed, setIsZoomed] = useState(false);
  const lastDist = useRef(0);
  const currentScale = useRef(1);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastDist.current = Math.hypot(dx, dy);
      }
    },
    [],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();

      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);

      if (lastDist.current > 0) {
        const delta = dist / lastDist.current;
        const newScale = Math.min(
          maxZoom,
          Math.max(minZoom, currentScale.current * delta),
        );
        currentScale.current = newScale;
        setScale(newScale);
        setIsZoomed(newScale > 1.05);
      }

      lastDist.current = dist;
    },
    [maxZoom, minZoom],
  );

  const handleTouchEnd = useCallback(() => {
    lastDist.current = 0;
    if (currentScale.current < 1.05) {
      currentScale.current = 1;
      setScale(1);
      setIsZoomed(false);
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (isZoomed) {
      currentScale.current = 1;
      setScale(1);
      setIsZoomed(false);
    } else {
      currentScale.current = 2.5;
      setScale(2.5);
      setIsZoomed(true);
    }
  }, [isZoomed]);

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden touch-none select-none ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
      style={{ cursor: isZoomed ? "zoom-out" : "zoom-in" }}
    >
      <div
        className="transition-transform duration-200 ease-out will-change-transform"
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
