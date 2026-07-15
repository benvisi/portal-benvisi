interface LoginErrorProps {
  message: string | null;
}

export function LoginError({ message }: LoginErrorProps) {
  return (
    <p
      role="alert"
      aria-live="polite"
      className={
        "min-h-5 text-center text-sm font-medium text-destructive transition-opacity " +
        (message ? "opacity-100" : "opacity-0")
      }
    >
      {message ?? ""}
    </p>
  );
}
