export const ROUTES = {
  LOGIN: "/",
  TERMS: "/termos",
  DASHBOARD: "/dashboard",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
