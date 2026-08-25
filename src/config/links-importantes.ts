export interface ExternalLinkResource {
  type: "external_link";
  id: string;
  titulo: string;
  descricao: string;
  supportingText?: string;
  externalNote: string;
  url: string;
  actionLabel: string;
}

export interface MobileAppResource {
  type: "mobile_app";
  id: string;
  titulo: string;
  descricao: string;
  instrucao: string;
  appStoreUrl: string;
  playStoreUrl: string;
}

export type ImportantResource = ExternalLinkResource | MobileAppResource;

// Operações, Milestone 4A: approved curated links. Portal is a front door
// to these external systems, not an owner/replacement of them — see
// Blueprint section 10 ("Links Importantes"). Exact titles/copy/URLs are
// approved product content; do not paraphrase or invent additional entries
// here without a new product decision.
export const IMPORTANT_RESOURCES: ImportantResource[] = [
  {
    type: "external_link",
    id: "canal-denuncia",
    titulo: "Canal de Denúncia Segura e Sigilosa",
    descricao:
      "Este canal é destinado ao relato de situações que ferem os valores da empresa, como assédio moral, assédio sexual, discriminação ou qualquer comportamento desrespeitoso.",
    supportingText:
      "Seu relato será tratado com total sigilo. Você não é obrigado(a) a se identificar.",
    externalNote: "O formulário é externo ao Portal Benvisi.",
    url: "https://forms.gle/w5UbXZ7BPwkUEzaLA",
    actionLabel: "Abrir formulário",
  },
  {
    type: "mobile_app",
    id: "yoobic-one",
    titulo: "YOOBIC ONE",
    descricao: "Treinamentos, conteúdos e atividades da Lacoste.",
    instrucao:
      "Se o aplicativo já estiver instalado, abra o YOOBIC ONE normalmente no seu celular. Caso contrário, instale pela loja do seu aparelho.",
    appStoreUrl: "https://apps.apple.com/br/app/yoobic-one/id1184286350",
    playStoreUrl: "https://play.google.com/store/apps/details?id=com.ipelia.yoobicv3&hl=pt_BR",
  },
  {
    type: "mobile_app",
    id: "crm360",
    titulo: "CRM360",
    descricao: "Acesso à plataforma de relacionamento e acompanhamento de clientes.",
    instrucao:
      "Se o aplicativo já estiver instalado, abra o CRM360 normalmente no seu celular. Caso contrário, instale pela loja do seu aparelho.",
    appStoreUrl: "https://apps.apple.com/br/app/crm360/id1592739160",
    playStoreUrl:
      "https://play.google.com/store/apps/details?id=br.com.giver.giver_lojista&hl=pt_BR",
  },
];
