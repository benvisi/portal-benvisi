export const ROUTES = {
  LOGIN: "/",
  TERMS: "/termos",
  DASHBOARD: "/dashboard",
  ATENDIMENTO: "/atendimento",
  ESTOQUE: "/estoque",
  ADMINISTRATIVO: "/administrativo",
  ADMINISTRATIVO_ESCALA: "/administrativo/escala",
  ADMINISTRATIVO_ATENDIMENTO: "/administrativo/atendimento",
  ADMINISTRATIVO_TERMOS_BUSCA: "/administrativo/termos-busca",
  CONHECIMENTO_CULTURA: "/conhecimento-cultura",
  CONHECIMENTO_CULTURA_PRINCIPIOS: "/conhecimento-cultura/principios",
  CONHECIMENTO_CULTURA_TAMANHOS_CALCADOS: "/conhecimento-cultura/tamanhos-calcados",
  OPERACOES: "/operacoes",
  OPERACOES_LINKS_IMPORTANTES: "/operacoes/links-importantes",
  OPERACOES_MENSAGENS_WHATSAPP: "/operacoes/mensagens-whatsapp",
  OPERACOES_ESCALA: "/operacoes/escala",
  OPERACOES_CONTAGEM_EMBALAGENS: "/operacoes/contagem-embalagens",
  OPERACOES_LIMPEZA: "/operacoes/limpeza",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
