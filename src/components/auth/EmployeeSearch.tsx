import { Search } from "lucide-react";
import { useEffect, useRef } from "react";

import { SEARCH_PLACEHOLDER } from "@/config/constants";

interface EmployeeSearchProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}

export function EmployeeSearch({ value, onChange, autoFocus = true }: EmployeeSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <div className="relative">
      <Search
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      />
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        autoComplete="off"
        aria-label={SEARCH_PLACEHOLDER}
        placeholder={SEARCH_PLACEHOLDER}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-touch w-full rounded-xl border border-input bg-card pl-10 pr-4 py-3 text-base text-foreground shadow-soft outline-none transition-colors placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
