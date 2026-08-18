export const ROUTES = {
  LOGIN: "/",
  TERMS: "/termos",
  DASHBOARD: "/dashboard",
  ATENDIMENTO: "/atendimento",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
