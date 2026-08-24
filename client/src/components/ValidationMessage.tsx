interface ValidationMessageProps {
  message?: string | null;
  show?: boolean;
  /** Optional id for aria-describedby association with the input */
  id?: string;
  /** Extra classes — use to fine-tune alignment with the field above */
  className?: string;
}

export default function ValidationMessage({
  message,
  id,
  className,
}: ValidationMessageProps) {
  if (!message) return null;
  return (
    <p
      id={id}
      className={`mt-1 px-4 text-[10px] font-bold text-red-400 leading-tight tracking-wide ${className ?? ""}`}>
      {message}
    </p>
  );
}
