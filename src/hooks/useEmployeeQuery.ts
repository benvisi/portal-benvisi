import { useQuery } from "@tanstack/react-query";

import { EMPLOYEES_QUERY_KEY } from "@/config/constants";
import { supabase } from "@/integrations/supabase/client";
import type { Employee } from "@/integrations/supabase/contracts";

async function fetchEmployees(): Promise<Employee[]> {
  const { data, error } = await supabase
    .from("funcionarios")
    .select("id, apelido, nome, cargo")
    .eq("is_active", true)
    .order("apelido", { ascending: true })
    .order("nome", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Employee[];
}

export function useEmployeeQuery() {
  return useQuery({
    queryKey: EMPLOYEES_QUERY_KEY,
    queryFn: fetchEmployees,
    staleTime: 60_000,
  });
}
