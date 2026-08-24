import { useState, useEffect } from "react";
import { X, Image, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { apiFetch } from "../utils/api";
import { downscaleImageFile } from "../utils/imageCompression";
import { useAutoGrow } from "../hooks/useAutoGrow";
import { logger } from "../utils/logger";
import { optimizeImageUrl } from "../utils/imageUrls";

interface EditPostModalProps {
  post: any;
  onClose: () => void;
  /** Called with the freshly returned post from the server after save. */
  onSaved?: (updated: any) => void;
}

interface ExistingImage {
  public_id: string;
  url: string;
}

export default function EditPostModal({
  post,
  onClose,
  onSaved,
}: EditPostModalProps) {
  const [title, setTitle] = useState(post?.title || "");
  const [content, setContent] = useState(post?.content || "");
  const contentRef = useAutoGrow<HTMLTextAreaElement>(content);
  const [existingImages, setExistingImages] = useState<ExistingImage[]>([]);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [newPreviews, setNewPreviews] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!post) return;
    setTitle(post.title || "");
    setContent(post.content || "");
    const imgs: ExistingImage[] = [];
    if (post.image?.public_id) {
      imgs.push({ public_id: post.image.public_id, url: post.image.url });
    }
    (post.images || []).forEach((img: any) => {
      if (img?.public_id && !imgs.some((e) => e.public_id === img.public_id)) {
        imgs.push({ public_id: img.public_id, url: img.url });
      }
    });
    setExistingImages(imgs);
    setNewFiles([]);
    setNewPreviews([]);
    setError("");
  }, [post]);

  // Revoke preview object URLs on unmount
  useEffect(() => {
    return () => {
      newPreviews.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const downscaled = await Promise.all(files.map((f) => downscaleImageFile(f)));
    setNewFiles((prev) => [...prev, ...downscaled]);
    setNewPreviews((prev) => [
      ...prev,
      ...downscaled.map((f) => URL.createObjectURL(f)),
    ]);
    e.target.value = "";
  };

  const removeNewImage = (idx: number) => {
    setNewPreviews((prev) => {
      if (prev[idx]) URL.revokeObjectURL(prev[idx]);
      return prev.filter((_, i) => i !== idx);
    });
    setNewFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!post?._id) return;
    // Guard against a fast double-click before React re-renders disabled.
    if (saving) return;
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    if (!content.trim()) {
      setError("Write a description for your post.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const formData = new FormData();
      formData.append("title", title.trim());
      formData.append("content", content.trim());
      existingImages.forEach((img) =>
        formData.append("existingImages", img.public_id),
      );
      for (const file of newFiles) {
        formData.append("images", file);
      }

      const res = await apiFetch(`/api/posts/${post._id}`, {
        method: "PUT",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || "Failed to update post");
      }

      // Clean up new preview URLs before closing
      newPreviews.forEach((u) => URL.revokeObjectURL(u));
      window.dispatchEvent(
        new CustomEvent("showToast", {
          detail: { message: "Post updated!", type: "success" },
        }),
      );
      onSaved?.(data.post || null);
      onClose();
    } catch (err: any) {
      logger.error("Edit post failed", err);
      setError(err.message || "Failed to update post.");
    } finally {
      setSaving(false);
    }
  };

  if (!post) return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[300] flex items-start justify-center p-4 pt-12 md:pt-20 overflow-y-auto bg-black/75"
      onClick={() => {
        // No closing mid-save — the upload must finish first.
        if (saving) return;
        onClose();
      }}
    >
      <motion.div
        initial={{ scale: 0.97, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="relative z-[310] w-full max-w-xl rounded-3xl border border-white/10 bg-zinc-950 p-5 md:p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.5)] mb-12"
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-display-xs text-white">Edit Post</h3>
          <button
            onClick={onClose}
            disabled={saving}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close edit post"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Post title"
            maxLength={500}
            disabled={saving}
            className="w-full rounded-lg border border-zinc-800 bg-zinc-900/50 py-3.5 px-5 text-[12px] md:text-sm text-white outline-none focus:border-zinc-600 transition-all disabled:opacity-50"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            ref={contentRef}
            placeholder="Post content"
            maxLength={5000}
            disabled={saving}
            className="w-full !rounded-lg border border-zinc-800 bg-zinc-900/55 py-3.5 px-5 text-[12px] md:text-sm text-white outline-none focus:border-white transition-all resize-none disabled:opacity-50"
          />

          {/* Existing images — show with remove button */}
          {existingImages.length > 0 && (
            <div>
              <label className="text-[12px] md:text-sm font-medium text-zinc-400 pl-3 mb-2 block">
                Current Images
              </label>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {existingImages.map((img) => (
                  <div
                    key={img.public_id}
                    className="relative shrink-0 overflow-hidden rounded-xl border border-zinc-800 w-20 h-20 group"
                  >
                    <img
                      loading="lazy"
                      src={optimizeImageUrl(img.url, 160)}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setExistingImages((prev) =>
                          prev.filter(
                            (p) => p.public_id !== img.public_id,
                          ),
                        )
                      }
                      className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-black transition-all z-20 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Remove image"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* New image previews */}
          {newPreviews.length > 0 && (
            <div>
              <label className="text-[12px] md:text-sm font-medium text-zinc-400 pl-3 mb-2 block">
                New Images
              </label>
              <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
                {newPreviews.map((preview, idx) => (
                  <div
                    key={idx}
                    className="relative shrink-0 overflow-hidden rounded-xl border border-zinc-800 w-20 h-20 group"
                  >
                    <img
                      loading="lazy"
                      src={preview}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => removeNewImage(idx)}
                      className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-black transition-all z-20 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label="Remove new image"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add image button */}
          <div className="relative">
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={saving}
              onChange={handleAddFiles}
              className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
              aria-label="Add image"
            />
            <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 py-3 text-[12px] md:text-sm font-medium text-zinc-400 hover:border-zinc-500 hover:text-zinc-300 transition-all pointer-events-none">
              <Image className="h-4 w-4" /> Add Image
            </div>
          </div>

          {error && (
            <p className="text-[11px] text-red-400 text-center">{error}</p>
          )}
        </div>

        <div className="flex gap-3.5 pt-4">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 rounded-full border border-zinc-800 py-3.5 text-[12px] md:text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-white cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-full bg-white py-3.5 text-sm font-semibold text-black hover:bg-zinc-200 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving...
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}
