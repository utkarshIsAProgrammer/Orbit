import React from "react";
import { Music, FileText, X } from "lucide-react";
import { optimizeImageUrl } from "../utils/imageUrls";

interface ChatGalleryProps {
	attachmentPreviews: string[];
	attachments: File[];
	removeAttachment: (index: number) => void;
}

const formatFileSize = (bytes?: number): string => {
	if (!bytes || bytes <= 0) return "";
	const units = ["B", "KB", "MB", "GB"];
	let i = 0;
	let size = bytes;
	while (size >= 1024 && i < units.length - 1) {
		size /= 1024;
		i++;
	}
	return `${size.toFixed(size >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export default React.memo(function ChatGallery({
	attachmentPreviews,
	attachments,
	removeAttachment,
}: ChatGalleryProps) {
	if (attachmentPreviews.length === 0) return null;

	return (
		<div className="flex gap-2 mb-3 bg-zinc-900/50 p-2.5 rounded-2xl border border-zinc-800 max-w-sm">
			{attachmentPreviews.map((url, idx) => {
				const file = attachments[idx];
				const isImage = file && file.type.startsWith("image/");
				const isVideo = file && file.type.startsWith("video/");
				const isAudio = file && file.type.startsWith("audio/");
				const isFile = file && !isImage && !isVideo && !isAudio;

				return (
					<div
						key={idx}
						className="relative rounded-lg border border-zinc-800 shrink-0 overflow-hidden">
						{isImage ? (
							<div className="h-14 w-14">
								<img
									loading="lazy"
									src={optimizeImageUrl(url, 112)}
									alt="Attachment preview"
									className="h-full w-full object-cover"
								/>
							</div>
						) : isVideo ? (
							<div className="h-14 w-14">
								<video
									src={url}
									className="h-full w-full object-cover bg-black"
									muted
									preload="metadata"
								/>
							</div>
						) : isAudio ? (
							<div className="h-14 w-14 flex items-center justify-center bg-zinc-900 text-zinc-400">
								<Music className="h-5 w-5" />
							</div>
						) : isFile ? (
							// File/document preview — icon + name + size, wider than media tiles
							<div className="flex h-14 w-44 items-center gap-2 bg-zinc-900 px-2.5">
								<FileText className="h-5 w-5 text-zinc-400 shrink-0" />
								<div className="min-w-0 flex-1">
									<p className="truncate text-[11px] font-semibold text-zinc-200" title={file.name}>
										{file.name}
									</p>
									<p className="text-[9px] text-zinc-500">{formatFileSize(file.size)}</p>
								</div>
							</div>
						) : null}
						<button
							type="button"
							onClick={() => removeAttachment(idx)}
							className="absolute top-1 right-1 h-4 w-4 bg-zinc-950/80 hover:bg-zinc-900 text-zinc-300 hover:text-white rounded-full flex items-center justify-center scale-90 z-20 cursor-pointer">
							<X className="h-2.5 w-2.5" />
						</button>
					</div>
				);
			})}
		</div>
	);
});
