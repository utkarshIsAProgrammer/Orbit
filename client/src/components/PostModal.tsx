import React, { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Check, Image, Loader2, ListTodo, Calendar, Clock, UserPlus, Globe, Lock } from "lucide-react";
import { apiFetch, uploadWithProgress } from "../utils/api";
import { logger } from "../utils/logger";
import { downscaleImageFile } from "../utils/imageCompression";
import { validatePost } from "../utils/validation";
import ValidationMessage from "./ValidationMessage";
import MentionSuggestions from "./MentionSuggestions";
import { useMentionAutocomplete } from "../hooks/useMentionAutocomplete";
import CharCounter from "./CharCounter";
import LinkPreviewCard from "./LinkPreviewCard";
import { extractFirstUrl } from "../utils/links";
import { useAutoGrow } from "../hooks/useAutoGrow";

interface PostModalProps {
	isOpen: boolean;
	onClose: () => void;
	onPostCreated: () => void;
	/** Current user id — used to reject self-collaboration inline. */
	currentUserId?: string;
}

interface PollOption {
	text: string;
}

export default function PostModal({
	isOpen,
	onClose,
	onPostCreated,
	currentUserId,
}: PostModalProps) {
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	// @mention autocomplete (post composer) — global user search.
	const {
		showMentionDropdown,
		candidateUsers: mentionCandidates,
		handleMentionChange,
		selectMentionCandidate,
		closeMentionDropdown,
	} = useMentionAutocomplete({ value: content, setValue: setContent });
	const mentionDropdownRef = useRef<HTMLDivElement>(null);
	const contentRef = useAutoGrow<HTMLTextAreaElement>(content, 360);
	// Debounced URL for the live link preview — only fetches once the user
	// stops typing for a beat, so a half-typed "https://g" doesn't fire a
	// request per keystroke (LinkPreviewCard caches by exact URL, so each
	// new char would otherwise bypass the cache and hit the API).
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);

	useEffect(() => {
		if (!content) {
			setPreviewUrl(null);
			return;
		}
		const url = extractFirstUrl(content);
		if (!url) {
			setPreviewUrl(null);
			return;
		}
		const t = setTimeout(() => setPreviewUrl(url), 600);
		return () => clearTimeout(t);
	}, [content]);
	const [postImageFiles, setPostImageFiles] = useState<File[]>([]);
	const [postImagePreviews, setPostImagePreviews] = useState<string[]>([]);
	const [submittingPost, setSubmittingPost] = useState(false);
	// Real upload progress (0–100) reported by the XHR upload — shown inside
	// the Post button while the form is locked during publishing.
	const [uploadProgress, setUploadProgress] = useState(0);
	// Ref mirror so the Escape-key handler (attached once in a stable effect)
	// can read the current submitting state without re-subscribing.
	const submittingRef = useRef(false);
	submittingRef.current = submittingPost;

	// Poll state
	const [showPollCreator, setShowPollCreator] = useState(false);
	const [pollOptions, setPollOptions] = useState<PollOption[]>([
		{ text: "" },
		{ text: "" },
	]);
	const [pollExpiry, setPollExpiry] = useState("1h");

	// Scheduling state
	const [showScheduler, setShowScheduler] = useState(false);
	const [scheduledAt, setScheduledAt] = useState("");
	const [isDraft, setIsDraft] = useState(false);

	// Audience — who can see this post
	const [visibility, setVisibility] = useState<"public" | "closeFriends">(
		"public",
	);

	// Collab invite state
	const [showCollabInvite, setShowCollabInvite] = useState(false);
	const [collabUsername, setCollabUsername] = useState("");
	// Inline collaborator validation: "checking…" → "user found" / "user not found"
	const [collabCheck, setCollabCheck] = useState<
		"idle" | "checking" | "found" | "notfound" | "self"
	>("idle");
	const collabCheckTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
		null,
	);

	// Clear pending lookups on unmount
	useEffect(() => {
		return () => {
			if (collabCheckTimer.current) clearTimeout(collabCheckTimer.current);
		};
	}, []);
	const collabUsernameRef = React.useRef("");
	collabUsernameRef.current = collabUsername;

	// Debounced input handler for the collaborator field.
	const handleCollabChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setCollabUsername(value);
		setCollabCheck(value.trim().replace(/^@/, "").length < 2 ? "idle" : "checking");
		if (collabCheckTimer.current) clearTimeout(collabCheckTimer.current);
		collabCheckTimer.current = setTimeout(() => {
			void checkCollaborator(value);
		}, 350);
	};

	// Debounced lookup of the collaborator @username so the user gets instant
	// inline feedback before publishing (avoid a failing request later).
	const checkCollaborator = React.useCallback(async (username: string) => {
		const trimmed = username.trim().replace(/^@/, "");
		if (trimmed.length < 2) {
			setCollabCheck("idle");
			return;
		}
		setCollabCheck("checking");
		try {
			const res = await apiFetch(
				`/api/users/username/${encodeURIComponent(trimmed)}`,
			);
			const data = await res.json();
			// Stale-response guard: only apply the result if the field still
			// holds the username we asked about (a slow response for "ali"
			// arriving after the user typed "bob" must be dropped).
			const stillCurrent =
				collabUsernameRef.current.trim().replace(/^@/, "") === trimmed;
			if (!stillCurrent) return;
			if (!res.ok || !data.success || !data.user) {
				setCollabCheck("notfound");
				return;
			}
			if (data.user._id === currentUserId) {
				setCollabCheck("self");
			} else {
				setCollabCheck("found");
			}
		} catch {
			if (
				collabUsernameRef.current.trim().replace(/^@/, "") === trimmed
			) {
				setCollabCheck("idle");
			}
		}
	}, [currentUserId]);

	// Preview object URLs — recreated whenever the selected files change.
	useEffect(() => {
		const previews = postImageFiles.map((f) => URL.createObjectURL(f));
		setPostImagePreviews((prev) => {
			prev.forEach((u) => URL.revokeObjectURL(u));
			return previews;
		});
		return () => previews.forEach((u) => URL.revokeObjectURL(u));
	}, [postImageFiles]);


	const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

	const clearFieldError = (field: string) => {
		setFieldErrors((prev) => {
			if (!prev[field]) return prev;
			const next = { ...prev };
			delete next[field];
			return next;
		});
	};

	// Close on Escape key + focus trap
	const modalRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) return;
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				// Don't allow closing while the post is being created — the
				// upload must finish or fail first.
				if (submittingRef.current) return;
				onClose();
				return;
			}
			if (e.key === "Tab") {
				const modal = modalRef.current;
				if (!modal) return;
				const focusable = modal.querySelectorAll<HTMLElement>(
					'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
				);
				if (focusable.length === 0) return;
				const first = focusable[0];
				const last = focusable[focusable.length - 1];
				if (e.shiftKey) {
					if (document.activeElement === first) {
						e.preventDefault();
						last.focus();
					}
				} else {
					if (document.activeElement === last) {
						e.preventDefault();
						first.focus();
					}
				}
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		requestAnimationFrame(() => {
			const firstFocusable = modalRef.current?.querySelector<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
			);
			firstFocusable?.focus();
		});
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, onClose]);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		// Guard against a fast double-click / Enter before React re-renders
		// the disabled state — the form must submit exactly once.
		if (submittingPost) return;
		const errors = validatePost({
			title,
			content,
			hasImages: postImageFiles.length > 0,
		});
		if (Object.keys(errors).length > 0) {
			setFieldErrors(errors);
			return;
		}
		setFieldErrors({});
		setSubmittingPost(true);

		// Validate poll
		if (showPollCreator) {
			const validOptions = pollOptions.filter((o) => o.text.trim());
			if (validOptions.length < 2) {
				setFieldErrors({ poll: "Add at least 2 poll options" });
				setSubmittingPost(false);
				return;
			}
		}

		// Validate scheduling: must be a future date/time
		if (showScheduler && scheduledAt) {
			if (new Date(scheduledAt).getTime() <= Date.now()) {
				setFieldErrors({ schedule: "Scheduled time must be in the future!" });
				setSubmittingPost(false);
				return;
			}
		}

		try {
			const formData = new FormData();
			formData.append("title", title);
			formData.append("content", content);
			formData.append("visibility", visibility);

			// Add poll data
			if (showPollCreator) {
				const validOptions = pollOptions.filter((o) => o.text.trim());
				formData.append("poll", JSON.stringify({
					options: validOptions.map((o) => ({ text: o.text.trim() })),
					expiresAt: pollExpiry === "never" ? null : getExpiryDate(pollExpiry),
				}));
			}

			// Add scheduling
			if (showScheduler && scheduledAt) {
				formData.append("scheduledAt", new Date(scheduledAt).toISOString());
				formData.append("status", "scheduled");
			} else if (isDraft) {
				formData.append("status", "draft");
			}

			// Files are already downscaled at selection time — append as-is
			// so the publish path stays fast (no re-decode on the critical path).
			postImageFiles.forEach((file) => {
				formData.append("images", file);
			});

			// Add collaborator
			if (collabUsername.trim()) {
				formData.append("collaborator", collabUsername.trim());
			}

			// Use the XHR upload helper so the locked button can report REAL
			// upload progress instead of an indeterminate spinner.
			const res = await uploadWithProgress("/api/posts", {
				method: "POST",
				body: formData,
				onProgress: (p) => setUploadProgress(p),
			});

			if (!res.ok) {
				const data = await res.json();
				throw new Error(data.message || "Failed to create post");
			}

			// Parse the response body on success to get the created post data
			const createdPostData = await res.json();

			// Revoke previous preview URLs to prevent memory leaks
			postImagePreviews.forEach((url) => URL.revokeObjectURL(url));
			setTitle("");
			setContent("");
			setPostImageFiles([]);
			setPostImagePreviews([]);
			setShowPollCreator(false);
			setPollOptions([{ text: "" }, { text: "" }]);
			setPollExpiry("1h");
			setShowScheduler(false);
			setScheduledAt("");
			setIsDraft(false);
			setVisibility("public");
			setCollabUsername("");
			setShowCollabInvite(false);

			const isScheduledPost = !!(
				createdPostData?.post?.status === "scheduled"
			);
			const isDraftPost = !!(createdPostData?.post?.status === "draft");

			// Only published posts are injected into the live feed.
			// Drafts & scheduled posts live in the user's drafts/scheduled
			// management area and appear in feeds at publish time.
			if (createdPostData?.post && !isScheduledPost && !isDraftPost) {
				window.dispatchEvent(
					new CustomEvent("newPostCreated", {
						detail: { post: createdPostData.post },
					}),
				);
			}

			if (isScheduledPost) {
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: `Post scheduled for ${new Date(
								createdPostData.post.scheduledAt,
							).toLocaleString()}`,
							type: "success",
						},
					}),
				);
			} else if (isDraftPost) {
				window.dispatchEvent(
					new CustomEvent("showToast", {
						detail: {
							message: "Draft saved! You can find it in your profile.",
							type: "success",
						},
					}),
				);
			}

			onPostCreated();
		} catch (err: any) {
			logger.error(err);
			window.dispatchEvent(
				new CustomEvent("showToast", {
					detail: {
						message:
							err.message ||
							"Failed to create post. Please try again.",
						type: "error",
					},
				}),
			);
		} finally {
			setUploadProgress(0);
			setSubmittingPost(false);
		}
	};

	const getExpiryDate = (expiry: string): string | null => {
		if (expiry === "never") return null;
		const now = new Date();
		const match = expiry.match(/^(\d+)([hdw])$/);
		if (!match) return null;
		const value = parseInt(match[1]);
		const unit = match[2];
		if (unit === "h") now.setHours(now.getHours() + value);
		else if (unit === "d") now.setDate(now.getDate() + value);
		else if (unit === "w") now.setDate(now.getDate() + value * 7);
		return now.toISOString();
	};

	const addPollOption = () => {
		if (pollOptions.length >= 10) return;
		setPollOptions((prev) => [...prev, { text: "" }]);
	};

	const updatePollOption = (index: number, text: string) => {
		setPollOptions((prev) =>
			prev.map((opt, i) => (i === index ? { ...opt, text } : opt)),
		);
	};

	const removePollOption = (index: number) => {
		if (pollOptions.length <= 2) return;
		setPollOptions((prev) => prev.filter((_, i) => i !== index));
	};

	if (!isOpen) return null;

	return (
		<AnimatePresence>
			<div
				key="post-modal-overlay"
				ref={modalRef}
				className="fixed inset-0 z-[300] flex items-center justify-center p-2 sm:p-4">					<motion.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						onClick={() => {
							// Backdrop click can't close the modal mid-upload either
							if (submittingPost) return;
							onClose();
						}}
						className="absolute inset-0 bg-black/60 backdrop-blur-sm"
					/>
				<motion.div
					initial={{ opacity: 0, scale: 0.95, y: 20 }}
					animate={{ opacity: 1, scale: 1, y: 0 }}
					exit={{ opacity: 0, scale: 0.95, y: 20 }}
					className="relative w-full max-w-lg bg-zinc-950/90 backdrop-blur-2xl rounded-2xl shadow-2xl overflow-hidden border border-zinc-800/50 max-h-[95vh] overflow-y-auto">
					<div className="flex items-center justify-between px-3 py-3 border-b border-zinc-100 dark:border-zinc-900 sm:px-4">
						<h2 className="text-label text-lg font-semibold text-black dark:text-white">
							Create Post
						</h2>
						<button
							onClick={onClose}
							disabled={submittingPost}
							className="p-2 bg-zinc-100 dark:bg-zinc-900 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-800 text-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed">
							<X className="w-5 h-5" />
						</button>
					</div>
					<div className="p-3 sm:p-4">
						<form
							onSubmit={handleSubmit}
							noValidate
							className="space-y-4">
							<div className="flex items-center gap-2">
								<input
									type="text"
									maxLength={500}
									placeholder="Give your post a title..."
									value={title}
									onChange={(e) => {
										setTitle(e.target.value);
										clearFieldError("title");
									}}
									autoFocus
									disabled={submittingPost}
									className="flex-1 bg-transparent text-[12px] md:text-sm font-bold text-slate-900 dark:text-zinc-100 placeholder-slate-400 dark:placeholder-zinc-600 outline-none disabled:opacity-50"
								/>
								<CharCounter current={title.length} max={500} />
							</div>
							<ValidationMessage message={fieldErrors.title} />
							<div className="relative">
							<textarea
								ref={contentRef}
								rows={4}
								placeholder="Write a description..."
								value={content}
								onChange={(e) => {
									const v = e.target.value;
									setContent(v);
									clearFieldError("content");
									handleMentionChange(v, e.target.selectionStart);
								}}
								maxLength={5000}
								disabled={submittingPost}
								onKeyDown={(e) => {
									if (
										showMentionDropdown &&
										(e.key === "ArrowDown" || e.key === "ArrowUp")
									) {
										e.preventDefault();
										mentionDropdownRef.current?.focus();
										return;
									}
									if (e.key === "Escape") closeMentionDropdown();
								}}
								className="w-full !rounded-lg resize-none bg-transparent text-[12px] md:text-sm text-slate-800 dark:text-zinc-300 placeholder-slate-500 dark:placeholder-zinc-500 outline-none disabled:opacity-50"
							/>
							<MentionSuggestions
								ref={mentionDropdownRef}
								candidates={mentionCandidates}
								onSelect={selectMentionCandidate}
								onClose={closeMentionDropdown}
								anchorRef={contentRef}
							/>
							</div>
							<div className="flex items-center justify-end mt-1">
								<CharCounter
									current={content.length}
									max={5000}
								/>
							</div>
							<ValidationMessage message={fieldErrors.content} />

							{/* Live link preview while composing — debounced so partial
								URLs while typing don't spam the preview API. */}
							{previewUrl && (
								<div className="mt-2">
									<LinkPreviewCard url={previewUrl} />
								</div>
							)}

							{/* Poll Creator */}
							{showPollCreator && (
								<div className="space-y-3 p-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20">
									<div className="flex items-center justify-between">
										<h3 className="text-label-sm font-semibold text-zinc-300 flex items-center gap-1.5">
											<ListTodo className="h-3.5 w-3.5" /> Poll
										</h3>											<button
												type="button"
												disabled={submittingPost}
												onClick={() => setShowPollCreator(false)}
												className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
												<X className="h-3.5 w-3.5" />
											</button>
									</div>
									{pollOptions.map((opt, idx) => (
										<div key={idx} className="flex items-center gap-2">
										<input
											type="text"
											placeholder={`Option ${idx + 1}`}
											value={opt.text}
											disabled={submittingPost}
											onChange={(e) => updatePollOption(idx, e.target.value)}
											maxLength={100}
											className="flex-1 bg-transparent border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 disabled:opacity-50"
										/>
											{pollOptions.length > 2 && (
												<button
													type="button"
													disabled={submittingPost}
													onClick={() => removePollOption(idx)}
													className="text-zinc-500 hover:text-red-400 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
												>
													<X className="h-3 w-3" />
												</button>
											)}
										</div>
									))}
									{pollOptions.length < 10 && (
										<button
											type="button"
											disabled={submittingPost}
											onClick={addPollOption}
											className="text-xs font-semibold text-zinc-400 hover:text-white transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
											+ Add option
										</button>
									)}
									<div className="flex items-center gap-2">
										<label className="text-[10px] font-bold text-zinc-500 uppercase">
											Poll duration:
										</label>
										<select
											value={pollExpiry}
											disabled={submittingPost}
											onChange={(e) => setPollExpiry(e.target.value)}
											className="bg-zinc-900 border border-zinc-700/50 rounded-lg px-2 py-1 text-xs text-zinc-300 outline-none focus:border-zinc-500 disabled:opacity-50"
										>
											<option value="1h">1 hour</option>
											<option value="6h">6 hours</option>
											<option value="12h">12 hours</option>
											<option value="24h">24 hours</option>
											<option value="3d">3 days</option>
											<option value="7d">7 days</option>
											<option value="never">No limit</option>
										</select>
									</div>
								</div>
							)}

							{/* Poll validation error */}
							<ValidationMessage message={fieldErrors.poll} />

							{/* Scheduling */}
							{showScheduler && (
								<div className="space-y-2 p-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20">
									<div className="flex items-center justify-between">
										<h3 className="text-label-sm font-semibold text-zinc-300 flex items-center gap-1.5">
											<Clock className="h-3.5 w-3.5" /> Schedule
										</h3>													<button
														type="button"
														disabled={submittingPost}
														onClick={() => {
															setShowScheduler(false);
															clearFieldError("schedule");
														}}
														className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
														<X className="h-3.5 w-3.5" />
													</button>
									</div>										<input
											type="datetime-local"
											value={scheduledAt}
											disabled={submittingPost}
											onChange={(e) => {
												setScheduledAt(e.target.value);
												clearFieldError("schedule");
											}}
											className="w-full bg-zinc-900 border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-zinc-300 outline-none focus:border-zinc-500 disabled:opacity-50"
										/>
								</div>
							)}
							{/* Schedule validation error */}
							<ValidationMessage message={fieldErrors.schedule} />

							{/* Image previews */}
							{postImagePreviews.length > 0 && (
								<div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin">
									{postImagePreviews.map((preview, idx) => (
										<div
											key={idx}
											className="relative shrink-0 overflow-hidden rounded-xl border border-zinc-800 w-20 h-20">
											<img
												loading="lazy"
												src={preview}
												alt=""
												className="w-full h-full object-cover"
											/>											<button
												type="button"
												disabled={submittingPost}
												onClick={() => {
													setPostImageFiles((prev) =>
														prev.filter(
														(_, i) => i !== idx,
													),
												);
													setPostImagePreviews(
														(prev) =>
															prev.filter(
																(_, i) =>
																	i !== idx,
															),
													);
												}}
												className="absolute top-1.5 right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black z-20 disabled:opacity-40 disabled:cursor-not-allowed">
												<X className="h-2.5 w-2.5" />
											</button>
										</div>
									))}
								</div>
							)}										{/* Collaborator invite — invite panel opens from the toggle below */}
										{showCollabInvite && (
								<div className="space-y-2 p-3 rounded-xl border border-zinc-800/40 bg-zinc-900/20">
									<div className="flex items-center justify-between">
										<h3 className="text-label-sm font-semibold text-zinc-300 flex items-center gap-1.5">
											<UserPlus className="h-3.5 w-3.5" /> Collaborator
										</h3>											<button
												type="button"
												disabled={submittingPost}
												onClick={() => setShowCollabInvite(false)}
												className="text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
												<X className="h-3.5 w-3.5" />
											</button>
									</div>										<input
											type="text"
											placeholder="Enter collaborator's @username"
											value={collabUsername}
											disabled={submittingPost}
											onChange={handleCollabChange}
											className="w-full bg-transparent border border-zinc-700/50 rounded-lg px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-zinc-500 disabled:opacity-50"
										/>
									{/* Inline validation hint — instant feedback while typing */}
									{collabCheck === "checking" && (
										<p className="text-[10px] text-zinc-500 flex items-center gap-1">
											<Loader2 className="h-3 w-3 animate-spin" /> Checking username...
										</p>
									)}
									{collabCheck === "found" && (
										<p className="text-[10px] text-emerald-400 flex items-center gap-1">
											<Check className="h-3 w-3" /> User found — they will be invited
										</p>
									)}
									{collabCheck === "notfound" && (
										<p className="text-[10px] text-red-400 flex items-center gap-1">
											<X className="h-3 w-3" /> No user found with that username
										</p>
									)}
									{collabCheck === "self" && (
										<p className="text-[10px] text-amber-400 flex items-center gap-1">
											<X className="h-3 w-3" /> You cannot collaborate with yourself
										</p>
									)}
									<p className="text-[10px] text-zinc-500">
										They will receive a notification to collaborate on this post
									</p>
								</div>
							)}

							<div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-zinc-900">
								<div className="flex items-center gap-2">
									{/* Image upload */}
									<div className="relative">
										<input
											type="file"
											accept="image/*"
											multiple
											disabled={postImageFiles.length >= 5 || submittingPost}
											onChange={async (e) => {
												const files = Array.from(
													e.target.files || [],
												);
												const remaining =
													5 - postImageFiles.length;
												const toAdd = files.slice(
													0,
													remaining,
												);
												// No forced crop box — images keep their natural
												// aspect ratio and are auto-downscaled for fast uploads.
												const processed = await Promise.all(
													toAdd.map((f) => downscaleImageFile(f)),
												);
												setPostImageFiles((prev) => [
													...prev,
													...processed,
												]);
												e.target.value = "";
											}}
											className="absolute inset-0 opacity-0 cursor-pointer disabled:cursor-not-allowed"
										/>
										<button
											type="button"
											tabIndex={-1}
											className={`flex h-10 w-10 items-center justify-center rounded-full text-zinc-650 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 cursor-pointer pointer-events-none ${
												submittingPost ? "opacity-40" : ""
											}`}>
											<Image className="h-5 w-5" />
										</button>
									</div>

									{/* Audience toggle — Public / Close Friends */}
									<button
										type="button"
										disabled={submittingPost}
										onClick={() =>
											setVisibility((v) =>
												v === "public" ? "closeFriends" : "public",
											)
										}
										className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
											visibility === "closeFriends"
												? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400/90"
												: "border-zinc-700/60 bg-zinc-800/40 text-zinc-300 hover:bg-zinc-800 hover:text-white"
										}`}
										title={
											visibility === "public"
												? "Visible to everyone"
												: "Only visible to your close friends"
										}
									>
										{visibility === "public" ? (
											<Globe className="h-3.5 w-3.5" />
										) : (
											<Lock className="h-3.5 w-3.5" />
										)}
										{visibility === "public" ? "Public" : "Close Friends"}
									</button>

									{/* Poll toggle */}
									<button
										type="button"
										disabled={submittingPost}
										onClick={() => setShowPollCreator(!showPollCreator)}
										className={`flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
										showPollCreator
											? "bg-white/15 text-white"
											: "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
										}`}
										title="Add poll"
									>
										<ListTodo className="h-4.5 w-4.5" />
									</button>

									{/* Schedule toggle */}
									<button
										type="button"
										disabled={submittingPost}
										onClick={() => setShowScheduler(!showScheduler)}
										className={`flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
											showScheduler
												? "bg-white/15 text-white"
												: "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
										}`}
										title="Schedule post"
									>
										<Calendar className="h-4.5 w-4.5" />
									</button>										{/* Collab toggle — invite a co-author to the post */}
										<button
											type="button"
											disabled={submittingPost}
											onClick={() => setShowCollabInvite((v) => !v)}
											className={`flex h-10 w-10 items-center justify-center rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
												showCollabInvite || collabUsername.trim()
													? "bg-white/15 text-white"
													: "text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900"
											}`}
											title={
												collabUsername.trim()
													? `Collaborating with @${collabUsername.replace(/^@/, "")}`
													: "Invite a collaborator"
											}
										>
											<UserPlus className="h-4.5 w-4.5" />
										</button>

									{postImageFiles.length > 0 && (
										<span className="text-[9px] text-zinc-500 ml-1">
											{postImageFiles.length}/5
										</span>
									)}
								</div>

								<div className="flex flex-col items-end gap-2">
									{visibility === "closeFriends" && (
										<div className="flex items-center justify-center gap-1.5 rounded-full border border-emerald-500/15 bg-emerald-500/5 px-3 py-1.5 text-[10px] font-bold text-emerald-400/80">
											<Lock className="h-3 w-3" />
											Only visible to your close friends
										</div>
									)}

									<div className="flex items-center gap-2">
									{/* Save as draft */}
									<button
										type="button"
										disabled={submittingPost}
										onClick={() => {
											setIsDraft(!isDraft);
											if (!isDraft) {
												setShowScheduler(false);
											}
										}}
										className={`text-[11px] font-bold px-3 py-1.5 rounded-full transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
											isDraft
												? "bg-amber-500/20 text-amber-400"
												: "text-zinc-500 hover:text-zinc-300"
										}`}
									>
										Draft
									</button>

									<button
										type="submit"
										disabled={submittingPost}
										className="rounded-full bg-white text-black hover:bg-zinc-200 border border-white/20 px-6 py-2 text-[12px] md:text-sm font-bold disabled:opacity-50 transition-all font-sans cursor-pointer">
						{submittingPost ? (
							<span className="flex items-center gap-1.5">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								{uploadProgress > 0 ? `${uploadProgress}%` : ""}
							</span>
						) : isDraft ? (
											"Save Draft"
										) : showScheduler ? (
											"Schedule"
										) : (
											"Post"
										)}
									</button>
									</div>
								</div>
							</div>
						</form>
					</div>
				</motion.div>
			</div>
		</AnimatePresence>
	);
}
