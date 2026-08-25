import { Eye, Gem, Handshake, Heart, ShieldCheck, type LucideIcon } from "lucide-react";

export interface Principio {
  id: string;
  titulo: string;
  icon: LucideIcon;
  atributosPessoais: string[];
  valoresCulturais: string[];
}

// Conhecimento & Cultura, Milestone 3A: approved static content for "Nossos
// Princípios" (Blueprint section — Conhecimento & Cultura). Content is fixed
// business copy, not editable by employees; adding/editing a principle later
// means editing this array, never duplicating markup per card.
export const PRINCIPIOS: Principio[] = [
  {
    id: "integridade",
    titulo: "Integridade",
    icon: ShieldCheck,
    atributosPessoais: ["Honestidade", "Credibilidade"],
    valoresCulturais: ["Justiça", "Ética", "Visão de longo prazo"],
  },
  {
    id: "foco-no-cliente",
    titulo: "Foco no Cliente",
    icon: Heart,
    atributosPessoais: ["Empatia", "Criatividade"],
    valoresCulturais: ["Atendimento superior", "Satisfação do cliente"],
  },
  {
    id: "colaboracao",
    titulo: "Colaboração",
    icon: Handshake,
    atributosPessoais: ["Comunicação", "Espírito de equipe"],
    valoresCulturais: ["Respeito", "Responsabilidade compartilhada"],
  },
  {
    id: "transparencia",
    titulo: "Transparência",
    icon: Eye,
    atributosPessoais: ["Sinceridade", "Clareza"],
    valoresCulturais: ["Confiabilidade", "Engajamento"],
  },
  {
    id: "qualidade",
    titulo: "Qualidade",
    icon: Gem,
    atributosPessoais: ["Melhoria contínua", "Meticulosidade"],
    valoresCulturais: ["Profissionalismo", "Experiência superior"],
  },
];
