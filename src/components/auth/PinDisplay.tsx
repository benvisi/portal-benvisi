interface PinDisplayProps {
  length: number;
  filled: number;
  hasError?: boolean;
}

export function PinDisplay({ length, filled, hasError = false }: PinDisplayProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`PIN com ${filled} de ${length} dígitos preenchidos`}
      className={"flex items-center justify-center gap-4 " + (hasError ? "animate-shake" : "")}
    >
      {Array.from({ length }).map((_, index) => {
        const isFilled = index < filled;
        return (
          <span
            key={index}
            aria-hidden
            className={
              "h-4 w-4 rounded-full border-2 transition-colors " +
              (hasError
                ? "border-destructive bg-destructive"
                : isFilled
                  ? "border-primary bg-primary"
                  : "border-border bg-transparent")
            }
          />
        );
      })}
    </div>
  );
}
