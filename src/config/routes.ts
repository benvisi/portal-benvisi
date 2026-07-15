export const ROUTES = {
  LOGIN: "/",
  DASHBOARD: "/dashboard",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
