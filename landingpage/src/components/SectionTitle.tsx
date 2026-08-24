import { SplitWords } from "./SplitWords";

interface SectionTitleProps {
  index: string;
  eyebrow: string;
  title: string;
  italic?: string;
  sub?: string;
  align?: "center" | "left";
  className?: string;
}

/** Numbered parenthesized eyebrow + display headline with masked word reveal. */
export function SectionTitle({
  index,
  eyebrow,
  title,
  italic,
  sub,
  align = "center",
  className = "",
}: SectionTitleProps) {
  const center = align === "center";
  return (
    <div className={`${className} ${center ? "mx-auto text-center" : "text-left"}`}>
      <div className={`u-label flex items-center gap-3 text-[11px] text-white/45 ${center ? "justify-center" : ""}`}>
        <span className="h-px w-8 bg-white/25" />
        ( {index}_{eyebrow.replace(/\s+/g, "_")} )
        <span className="h-px w-8 bg-white/25" />
      </div>
      <SplitWords
        as="h2"
        text={title}
        italic={italic}
        className="headline mt-5 text-5xl text-white sm:text-6xl md:text-7xl"
      />
      {sub && (
        <p className={`mt-5 max-w-md text-sm leading-relaxed text-mist ${center ? "mx-auto" : ""}`}>
          {sub}
        </p>
      )}
    </div>
  );
}
