import { useQuery } from "@tanstack/react-query";

import { EMPLOYEES_QUERY_KEY } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import { isEmployee, type Employee } from "@/integrations/supabase/contracts";

async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase.rpc("list_active_employees");

  if (error) throw error;

  const rows = Array.isArray(data) ? data : [];
  const employees = rows.filter(isEmployee);

  employees.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return employees;
}

export function useEmployeeQuery() {
  return useQuery({
    queryKey: EMPLOYEES_QUERY_KEY,
    queryFn: fetchEmployees,
    staleTime: 60_000,
  });
}
