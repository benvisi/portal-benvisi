import { Delete } from "lucide-react";

import { KEYPAD_BUTTON_MIN_PX } from "@/config/constants";

interface NumericKeypadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  disabled?: boolean;
}

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;

export function NumericKeypad({ onDigit, onBackspace, disabled = false }: NumericKeypadProps) {
  const buttonStyle = { minHeight: KEYPAD_BUTTON_MIN_PX, minWidth: KEYPAD_BUTTON_MIN_PX };

  return (
    <div
      role="group"
      aria-label="Teclado numérico"
      className="grid grid-cols-3 gap-3"
      aria-disabled={disabled}
    >
      {DIGITS.map((digit) => (
        <button
          key={digit}
          type="button"
          disabled={disabled}
          aria-label={`Dígito ${digit}`}
          onClick={() => onDigit(digit)}
          style={buttonStyle}
          className="flex items-center justify-center rounded-xl border border-border bg-card text-2xl font-semibold text-foreground shadow-soft transition-colors hover:bg-accent active:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {digit}
        </button>
      ))}
      <button
        type="button"
        disabled={disabled}
        aria-label="Apagar último dígito"
        onClick={onBackspace}
        style={buttonStyle}
        className="flex items-center justify-center rounded-xl border border-border bg-card text-foreground shadow-soft transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Delete className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-label="Dígito 0"
        onClick={() => onDigit("0")}
        style={buttonStyle}
        className="col-span-2 flex items-center justify-center rounded-xl border border-border bg-card text-2xl font-semibold text-foreground shadow-soft transition-colors hover:bg-accent active:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        0
      </button>
    </div>
  );
}
