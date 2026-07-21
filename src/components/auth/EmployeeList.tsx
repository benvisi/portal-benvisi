import type { Employee } from "@/integrations/supabase/contracts";

interface EmployeeListProps {
  employees: Employee[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyMessage?: string;
}

export function EmployeeList({
  employees,
  selectedId,
  onSelect,
  emptyMessage = "Nenhum funcionário encontrado.",
}: EmployeeListProps) {
  if (employees.length === 0) {
    return <p className="px-2 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul role="listbox" aria-label="Funcionários" className="flex flex-col gap-2">
      {employees.map((employee) => {
        const isSelected = employee.funcionario_id === selectedId;
        return (
          <li key={employee.funcionario_id}>
            <button
              type="button"
              role="option"
              aria-selected={isSelected}
              onClick={() => onSelect(employee.funcionario_id)}
              className={
                "min-touch flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left shadow-soft transition-all " +
                (isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-accent")
              }
            >
              <span className="text-base font-semibold">{employee.nome}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
