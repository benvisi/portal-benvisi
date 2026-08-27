export const ROUTES = {
  LOGIN: "/",
  TERMS: "/termos",
  DASHBOARD: "/dashboard",
  ATENDIMENTO: "/atendimento",
  ADMINISTRATIVO: "/administrativo",
  CONHECIMENTO_CULTURA: "/conhecimento-cultura",
  CONHECIMENTO_CULTURA_PRINCIPIOS: "/conhecimento-cultura/principios",
  OPERACOES: "/operacoes",
  OPERACOES_LINKS_IMPORTANTES: "/operacoes/links-importantes",
  OPERACOES_MENSAGENS_WHATSAPP: "/operacoes/mensagens-whatsapp",
  OPERACOES_ESCALA: "/operacoes/escala",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
