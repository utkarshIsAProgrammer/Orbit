import React, { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Hash, Loader2, Camera } from "lucide-react";
import ImageCropModal from "./ImageCropModal";
import { apiFetch } from "../utils/api";
import { logger } from "../utils/logger";
import { downscaleImageFile } from "../utils/imageCompression";
import { useAutoGrow } from "../hooks/useAutoGrow";
import type { Community } from "../types";

interface CreateCommunityModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (community: Community) => void;
}

export default function CreateCommunityModal({
  isOpen,
  onClose,
  onCreated,
}: CreateCommunityModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const descriptionRef = useAutoGrow<HTMLTextAreaElement>(description);
  const [imageFile, setImageFile] = useState<File | null>(null);
	const [imagePreview, setImagePreview] = useState<string | null>(null);
	const [cropModalOpen, setCropModalOpen] = useState(false);
	const [cropSrc, setCropSrc] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<"public" | "private">("public");
  const fileInputRef = useRef<HTMLInputElement>(null);	const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) return;
		if (!file.type.startsWith("image/")) {
			setError("Only image files are allowed!");
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			setError("Image size must be under 5MB!");
			return;
		}
		// Revoke previous preview if any
		if (imagePreview) URL.revokeObjectURL(imagePreview);
		setCropSrc(URL.createObjectURL(file));
		setCropModalOpen(true);
		setError(null);
	};

	const handleCropComplete = useCallback((croppedBlob: Blob) => {
		const croppedFile = new File([croppedBlob], "community_avatar.jpg", { type: "image/jpeg" });
		setImageFile(croppedFile);
		setImagePreview(URL.createObjectURL(croppedBlob));
	}, []);

  const removeImage = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Community name is required!");
      return;
    }
    if (name.trim().length > 50) {
      setError("Community name cannot exceed 50 characters!");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("description", description.trim());
      formData.append("privacy", privacy);
      if (imageFile) {
        formData.append("image", await downscaleImageFile(imageFile, 800));
      }

      // Don't set Content-Type header — let fetch set multipart/form-data with boundary
      const res = await apiFetch("/api/communities", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.success) {
        onCreated(data.community);
        setName("");
        setDescription("");
        removeImage();
        onClose();
      } else {
        setError(data.message || "Failed to create community");
      }
    } catch (err: any) {
      logger.error("Failed to create community", err);
      setError("Failed to create community. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="w-full max-w-md rounded-2xl border border-zinc-800/50 bg-zinc-950/90 backdrop-blur-xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 border-b border-zinc-800/50">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-zinc-400" />
                <h2 className="text-label text-lg font-semibold text-white">Create Community</h2>
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <X className="h-4 w-4 text-zinc-400" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-4">
              {/* Image picker */}
              <div className="flex justify-center">
                <div className="relative group">
                  <div className="h-20 w-20 rounded-2xl bg-zinc-800 flex items-center justify-center border border-zinc-700/50 overflow-hidden">
                    {imagePreview ? (
                      <img
                        src={imagePreview}
                        alt="Community preview"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Hash className="h-8 w-8 text-zinc-500" />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => imagePreview ? removeImage() : fileInputRef.current?.click()}
                    className="absolute -bottom-1 -right-1 h-7 w-7 rounded-full bg-zinc-700 hover:bg-zinc-600 border-2 border-zinc-950 flex items-center justify-center transition-all cursor-pointer"
                    title={imagePreview ? "Remove image" : "Upload image"}
                  >
                    {imagePreview ? (
                      <X className="h-3.5 w-3.5 text-zinc-300" />
                    ) : (
                      <Camera className="h-3.5 w-3.5 text-zinc-300" />
                    )}
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleImageSelect}
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Community Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Design Lovers"
                  maxLength={50}
                  className="w-full bg-zinc-900/80 border border-zinc-800/60 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/40 transition-all"
                  autoFocus
                />
                <p className="text-[10px] text-zinc-600 mt-1 text-right">{name.length}/50</p>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Description (optional)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  ref={descriptionRef} placeholder="What's this community about?"
                  maxLength={500}
                  rows={3}
                  className="w-full bg-zinc-900/80 border border-zinc-800/60 !rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/40 transition-all resize-none"
                />
                <p className="text-[10px] text-zinc-600 mt-1 text-right">{description.length}/500</p>
              </div>

              {/* Privacy — who can join. Chosen by the creator at creation
                  time; can be changed later in Settings → Privacy. */}
              <div>
                <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-1.5">
                  Who can join?
                </label>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-zinc-800/60 bg-zinc-900/50 p-1">
                  <button
                    type="button"
                    onClick={() => setPrivacy("public")}
                    className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 transition-all cursor-pointer ${
                      privacy === "public"						? "pill-active"
						: "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span className="text-xs font-bold">Public</span>					<span className={`text-[9px] ${privacy === "public" ? "text-zinc-300" : "text-zinc-500"}`}>
                      Anyone can join instantly
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setPrivacy("private")}
                    className={`flex flex-col items-center gap-0.5 rounded-lg px-3 py-2 transition-all cursor-pointer ${
                      privacy === "private"						? "pill-active"
						: "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <span className="text-xs font-bold">Private</span>					<span className={`text-[9px] ${privacy === "private" ? "text-zinc-300" : "text-zinc-500"}`}>
                      Members must be approved
                    </span>
                  </button>
                </div>
              </div>

              {error && (
                <p className="text-[11px] font-semibold text-red-400 bg-red-500/10 rounded-lg px-3 py-2 border border-red-500/20">
                  {error}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 rounded-xl border border-zinc-800/60 py-2.5 text-xs font-bold text-zinc-400 hover:text-white hover:bg-zinc-800/50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading || !name.trim()}
                  className="flex-1 rounded-xl bg-white hover:bg-zinc-200 disabled:bg-zinc-800 disabled:text-zinc-600 py-2.5 text-xs font-bold text-black transition-all cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Community"
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}

      {/* Crop Modal */}
      <ImageCropModal
        isOpen={cropModalOpen}
        onClose={() => {
          setCropModalOpen(false);
          if (cropSrc) URL.revokeObjectURL(cropSrc);
        }}
        imageSrc={cropSrc}
        title="Community Avatar Crop"
        onCropComplete={handleCropComplete}
      />
    </AnimatePresence>
  );
}
