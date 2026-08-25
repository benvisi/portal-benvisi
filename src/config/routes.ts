export const ROUTES = {
  LOGIN: "/",
  TERMS: "/termos",
  DASHBOARD: "/dashboard",
  ATENDIMENTO: "/atendimento",
  ADMINISTRATIVO: "/administrativo",
  CONHECIMENTO_CULTURA: "/conhecimento-cultura",
  CONHECIMENTO_CULTURA_PRINCIPIOS: "/conhecimento-cultura/principios",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
