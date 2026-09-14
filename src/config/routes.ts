export const ROUTES = {
  LOGIN: "/",
  TERMS: "/termos",
  DASHBOARD: "/dashboard",
  ATENDIMENTO: "/atendimento",
  ESTOQUE: "/estoque",
  ADMINISTRATIVO: "/administrativo",
  ADMINISTRATIVO_ESCALA: "/administrativo/escala",
  ADMINISTRATIVO_ATENDIMENTO: "/administrativo/atendimento",
  CONHECIMENTO_CULTURA: "/conhecimento-cultura",
  CONHECIMENTO_CULTURA_PRINCIPIOS: "/conhecimento-cultura/principios",
  OPERACOES: "/operacoes",
  OPERACOES_LINKS_IMPORTANTES: "/operacoes/links-importantes",
  OPERACOES_MENSAGENS_WHATSAPP: "/operacoes/mensagens-whatsapp",
  OPERACOES_ESCALA: "/operacoes/escala",
  OPERACOES_CONTAGEM_EMBALAGENS: "/operacoes/contagem-embalagens",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
