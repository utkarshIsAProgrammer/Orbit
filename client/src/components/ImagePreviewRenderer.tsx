import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X } from "lucide-react";

export type PreviewPayload =
  | string
  | { url: string; variant?: "avatar" }
  | { url: string; type: "video" };

export const openImagePreview = (payload: PreviewPayload) => {
  window.dispatchEvent(new CustomEvent("openImagePreview", { detail: payload }));
};

export default function ImagePreviewRenderer() {
  const [preview, setPreview] = useState<PreviewPayload | null>(null);

  useEffect(() => {
    const handleOpen = (e: Event) => {
      const customEvent = e as CustomEvent<PreviewPayload>;
      setPreview(customEvent.detail);
    };
    window.addEventListener("openImagePreview", handleOpen);
    return () => window.removeEventListener("openImagePreview", handleOpen);
  }, []);

  const imageUrl =
    preview !== null && typeof preview === "string"
      ? preview
      : (preview !== null && preview !== undefined
          ? preview.url
          : null);
  const isAvatar =
    preview !== null &&
    preview !== undefined &&
    typeof preview === "object" &&
    "variant" in preview &&
    preview.variant === "avatar";
  const isVideo =
    preview !== null &&
    preview !== undefined &&
    typeof preview === "object" &&
    "type" in preview &&
    preview.type === "video";

  const close = () => setPreview(null);

  return (
    <AnimatePresence>
      {imageUrl && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-md p-4"
          onClick={close}
        >
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute top-6 right-6 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors backdrop-blur-xl"
            onClick={close}
          >
            <X className="h-5 w-5" />
          </motion.button>

          {isVideo ? (
            <motion.video
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              src={imageUrl}
              autoPlay
              muted
              playsInline
              controls
              className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl bg-black"
              onClick={(e) => e.stopPropagation()}
            />
          ) : isAvatar ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.85 }}
              transition={{ type: "spring", stiffness: 260, damping: 22 }}
              onClick={(e) => e.stopPropagation()}
              className="relative"
            >
              {/* Soft glow ring behind the circle for a premium look */}
              <div className="absolute -inset-3 rounded-full bg-white/10 blur-2xl" />
              <img
                src={imageUrl}
                alt="Profile picture"
                className="relative h-[min(62vh,22rem)] w-[min(62vh,22rem)] rounded-full object-cover shadow-2xl ring-4 ring-white/20"
              />
            </motion.div>
          ) : (
            <motion.img
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
              src={imageUrl}
              alt="Fullscreen preview"
              className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
