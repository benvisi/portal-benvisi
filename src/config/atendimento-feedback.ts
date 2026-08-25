import type { CSSProperties } from "react";
import { toast } from "sonner";

import type { MotivoCategoria } from "@/integrations/supabase/contracts";

/**
 * Milestone 2E — Positive Reinforcement After Atendimento (Blueprint section
 * 8.15). This entire file is curated, product-owner-approved production
 * content. Do not rewrite, "improve", translate, normalize, or replace any
 * message — including emoji, capitalization, or punctuation — without an
 * explicit new product decision. No runtime AI generation is used; selection
 * is a deterministic local random pick from these fixed pools.
 */

export type AtendimentoOutcomeCategory = "converted" | "non_converted" | "mixed";

// Exactly 100 — used when every customer in the Atendimento converted.
export const CONVERTED_MESSAGES = [
  "Venda espetacular! 🚀",
  "Sacola cheia, cliente feliz! 🛍️",
  "Conversão perfeita! 🎯",
  "Show de vendas! 🌟",
  "Brilhou na venda! ✨",
  "Mais uma conversão! ✅",
  "Resultado excelente! 🏆",
  "Ótimo resultado! 🔥",
  "Arrasou no fechamento! 💥",
  "Lindo atendimento! 👏",
  "Cliente encantado! 😍",
  "Faturamento subindo! 📈",
  "Orgulho da equipe! 🏅",
  "Receita de sucesso! 💎",
  "Venda de mestre! 👑",
  "Impecável! 👌",
  "Energia de vendas! ⚡",
  "Fechou com estilo! 🕶️",
  "Máquina de vendas! 🤖",
  "Desempenho top! 🔝",
  "Cliente fidelizado! 🤝",
  "Mandou muito bem! 👊",
  "Venda registrada! 📝",
  "Sucesso total! 🥳",
  "Atendimento premium! 🥇",
  "Voando nas vendas! 🦅",
  "Classe A! ⭐",
  "Poder de persuasão! 🧠",
  "Venda concluída! ✔️",
  "Quebrou objeções! 🔨",
  "Gigante nas vendas! 🦍",
  "O salão é seu! 🏟️",
  "Talento puro! 💫",
  "Mestre da conversão! 🧙",
  "Venda incrível! 🌈",
  "Resultado máximo! 💯",
  "Atendimento de ouro! 🥇",
  "Fechamento cirúrgico! 🩺",
  "Cliente satisfeito! 😃",
  "Elevou o nível! 🚀",
  "Vitória na pista! 🏁",
  "Mais um na sacola! 🛍️",
  "Conversão de elite! 🎖️",
  "Atendimento VIP! 🥂",
  "Foco no resultado! 🎯",
  "Brilhante! 💡",
  "Venda confirmada! 🔒",
  "Show de bola! ⚽",
  "Goleada nas vendas! 🥅",
  "Sempre fechando! 💼",
  "Arte de vender! 🎨",
  "Excelente argumento! 🗣️",
  "Venda garantida! 🛡️",
  "Mais uma conquista! 🏆",
  "Sorriso no rosto! 😁",
  "Atendimento ágil! ⚡",
  "Faturamento garantido! 💰",
  "Profissionalismo puro! 👔",
  "Referência no salão! 🌟",
  "Imparável! 🚂",
  "Venda veloz! 🏎️",
  "Fechamento de craque! ⚽",
  "Sucesso na conversão! 🎯",
  "Cliente apaixonado! 💖",
  "Atendimento brilhante! ✨",
  "Resultado fantástico! 🎆",
  "Meta alcançada! 🎯",
  "Performance impecável! 📈",
  "Venda maravilhosa! 🌸",
  "Top performer! 🌟",
  "Arrebentou! 💥",
  "Conversão master! 👑",
  "Cliente ganhou o dia! ☀️",
  "Muito bem feito! 👏",
  "Venda espetacular! 🎢",
  "Salão dominado! 🦁",
  "Fechamento top! 🔝",
  "Sempre no foco! 🔭",
  "Energia lá em cima! 🔋",
  "Venda de impacto! ☄️",
  "Cliente bem atendido! 😌",
  "Conversão sólida! 🧱",
  "Excelente abordagem! 🎯",
  "Venda redonda! 🔴",
  "Sucesso na pista! 🛣️",
  "Atendimento nota mil! 💯",
  "Orgulho Benvisi! 💚",
  "Experiência perfeita! 🎁",
  "Venda comemorada! 🎉",
  "Fechamento de ouro! 🏆",
  "Vitória da equipe! 🙌",
  "Conversão impecável! 💎",
  "Cliente fã! 🤩",
  "Show de empatia! 🤗",
  "Venda confirmada! ✅",
  "Faturamento na conta! 💳",
  "Arrasou muito! 💃",
  "O melhor atendimento! 🌟",
  "Sucesso absoluto! 🎇",
  "Conversão cem porcento! 💯",
] as const;

// Exactly 150 — used when every customer in the Atendimento did not convert.
export const NON_CONVERTED_MESSAGES = [
  "O giro continua! 🔄",
  "Próxima chance! 🎲",
  "Foco no próximo! 👀",
  "A fila anda! 🚶",
  "O jogo não parou! ⏳",
  "Sorriso no rosto! 😁",
  "Faz parte do processo! 📈",
  "Mais uma oportunidade! 🚪",
  "Bola pra frente! ⚽",
  "A experiência conta! 🧠",
  "Nem todo mundo compra! 🛍️",
  "Cabeça erguida! 🦒",
  "Próximo cliente te espera! 🙋",
  "Mantenha a energia! ⚡",
  "Foco na próxima venda! 🎯",
  "Respire fundo! 🌬️",
  "A pista é sua! 🛣️",
  "Siga em frente! ➡️",
  "Atendimento concluído! ✅",
  "Cada não ensina! 📚",
  "Ajuste a rota! 🧭",
  "Vamos pra próxima! 🏃",
  "Tudo é aprendizado! 💡",
  "Foco no atendimento! 🎯",
  "A fila da vez te chama! 🔔",
  "Não desanime! 🛡️",
  "O salão continua vivo! 🌟",
  "Mantenha o padrão! 📏",
  "Próxima vez dá certo! 👍",
  "Preparado para o próximo! 🥊",
  "Foco no futuro! 🔭",
  "O próximo é seu! 🫵",
  "Siga forte! 💪",
  "Mantenha o ritmo! 🥁",
  "Atendimento limpo! 🧼",
  "Mais sorte na próxima! 🍀",
  "Oportunidades não faltam! 🔄",
  "Fique atento! ⚠️",
  "O próximo passo! 👣",
  "Persistência é a chave! 🔑",
  "A fila girou! 🎡",
  "Nada de tristeza! 🚫",
  "Levante a cabeça! 🆙",
  "Outro cliente chegou! 🚪",
  "Continue tentando! 🛠️",
  "Foco na meta! 🎯",
  "Amanhã é outro dia! 🌅",
  "Atendimento registrado! 📝",
  "Sem estresse! 🧘",
  "Tudo sob controle! 🎛️",
  "A próxima sacola é sua! 🛍️",
  "Confie no seu talento! 🌟",
  "O giro é rápido! 🌪️",
  "Vamos lá de novo! 🔁",
  "Faz parte do salão! 🏪",
  "Experiência adquirida! 🎓",
  "Mantenha a calma! 🧊",
  "Oportunidade seguinte! ⏭️",
  "Sempre alerta! 🚨",
  "Próxima abordagem! 🗣️",
  "Foco no argumento! 💬",
  "O salão não para! 🛑",
  "Siga o fluxo! 🌊",
  "Mais foco! 🔍",
  "O cliente levou a marca! 💚",
  "Experiência entregue! 🎁",
  "Tente diferente! 🔄",
  "Não perca o pique! 🏃",
  "O próximo vai fechar! 🔒",
  "A fila está rodando! 🎡",
  "Mantenha a simpatia! 😊",
  "Cliente volta depois! 🔙",
  "Foco na técnica! ⚙️",
  "Ajuste os detalhes! 🔍",
  "Oportunidade nova! 📦",
  "A pista chama! 📣",
  "Você consegue! 💪",
  "Sempre evoluindo! 🌱",
  "O próximo é conversão! 🎯",
  "Cabeça no jogo! 🎮",
  "Atendimento concluído com atenção! 🛡️",
  "Experiência positiva! ✔️",
  "Cada atendimento traz aprendizado! 🔄",
  "Oportunidades se renovam! 🌅",
  "O amanhã promete! 📅",
  "A vez vai chegar! ⏱️",
  "Mantenha a excelência! 🌟",
  "Cada cliente é único! 👤",
  "Próxima chance de ouro! 🥇",
  "Continue brilhando! ✨",
  "Foco e determinação! 😤",
  "Não desista nunca! 🧗",
  "Oportunidade logo ali! 🛣️",
  "Fila atualizada! 📋",
  "Mantenha o sorriso! 😁",
  "O jogo vira! 🎢",
  "A venda te espera! 🛍️",
  "Energia renovada! 🔋",
  "Siga confiante! 🦁",
  "O giro não para! 🔄",
  "Mais um atendimento concluído! ✅",
  "Seguimos para a próxima oportunidade! ➡️",
  "Cada atendimento conta! 🌟",
  "Próximo cliente, nova oportunidade! 🚪",
  "Mais uma experiência entregue! 🎁",
  "O próximo atendimento já vem aí! 👀",
  "Seguimos com energia! ⚡",
  "Um atendimento de cada vez! 👣",
  "Continue fazendo a diferença! ✨",
  "Mais uma oportunidade de aprender! 📚",
  "Atendimento feito, seguimos! ✅",
  "Próximo cliente, novo começo! 🌅",
  "Cada conversa é uma oportunidade! 💬",
  "Mantenha o bom atendimento! 👏",
  "Seguimos no ritmo! 🥁",
  "Mais uma experiência construída! 🧱",
  "Próxima oportunidade à frente! ➡️",
  "Um novo cliente pode chegar a qualquer momento! 🚪",
  "Mais uma etapa concluída! ✔️",
  "Continue atento às oportunidades! 👀",
  "O importante é seguir atendendo bem! 🌟",
  "Mais uma experiência de atendimento! 🤝",
  "Próximo atendimento, novas possibilidades! 🔄",
  "Continue com a mesma energia! 🔋",
  "Seguimos construindo boas experiências! 💚",
  "Mais um cliente bem recebido! 🙌",
  "Cada atendimento abre novas possibilidades! 🚪",
  "Continue presente e atento! 👀",
  "Mais uma oportunidade passou, outras virão! 🌅",
  "Atendimento concluído. Seguimos em frente! ➡️",
  "Próxima conversa, nova chance! 💬",
  "Continue oferecendo uma ótima experiência! ✨",
  "Mais um atendimento para a experiência! 📚",
  "O próximo cliente pode surpreender! 🎁",
  "Mantenha o foco e a atenção! 🎯",
  "Seguimos com o mesmo cuidado! 💚",
  "Mais uma interação concluída! ✅",
  "Cada cliente traz uma nova oportunidade! 🌟",
  "Próximo atendimento, mesmo cuidado! 🤝",
  "Continue recebendo cada cliente com atenção! 👏",
  "Mais um passo no dia! 👣",
  "Seguimos atentos ao próximo cliente! 👀",
  "Mais uma oportunidade de conectar! 🤝",
  "Atendimento encerrado. Próxima oportunidade! 🔄",
  "Continue criando boas experiências! ✨",
  "Cada atendimento ajuda a evoluir! 🌱",
  "Seguimos com foco no cliente! 🎯",
  "Nova oportunidade a caminho! 🚪",
  "Mais um atendimento feito com dedicação! 🙌",
  "Seguimos para o próximo! ➡️",
] as const;

// Exactly 25 — used when the Atendimento contains at least one Convertido
// AND at least one Não convertido customer.
export const MIXED_MESSAGES = [
  "Atendimento concluído com sucesso! ✅",
  "Bom trabalho com todos os clientes! 👏",
  "Mais um atendimento bem conduzido! 🌟",
  "Excelente trabalho no salão! ✨",
  "Atendimento completo! Vamos em frente! 🚀",
  "Mandou bem nesse atendimento! 👊",
  "Mais uma boa experiência entregue! 🎁",
  "Atendimento finalizado com excelência! ⭐",
  "Bom trabalho do início ao fim! 🙌",
  "Mais um atendimento registrado! ✅",
  "Ótima condução do atendimento! 👏",
  "Trabalho bem feito! 🌟",
  "Cliente bem atendido é sempre resultado! 💚",
  "Mais uma experiência Lacoste bem entregue! 🐊",
  "Atendimento concluído. Seguimos! 🚀",
  "Excelente presença no salão! ✨",
  "Mais um atendimento completo! 🎯",
  "Boa condução e ótimo trabalho! 👌",
  "Experiência bem cuidada! 💚",
  "Atendimento feito com atenção! 👏",
  "Mais uma oportunidade bem aproveitada! 🌟",
  "Bom trabalho com cada cliente! 🙌",
  "Atendimento encerrado com qualidade! ✅",
  "Mais uma experiência bem conduzida! ✨",
  "Tudo certo por aqui. Próximo atendimento! 🚀",
] as const;

/**
 * Determines the reinforcement category from the exact set of customer
 * outcome categories submitted for a successfully completed Atendimento
 * (section 2/18) — "mixed" only when both categories are present; a single
 * customer (either outcome) uses its own dedicated pool, never "mixed".
 */
function classifyAtendimentoOutcome(
  categorias: readonly MotivoCategoria[],
): AtendimentoOutcomeCategory {
  const temConvertido = categorias.includes("convertido");
  const temNaoConvertido = categorias.includes("nao_convertido");
  if (temConvertido && temNaoConvertido) return "mixed";
  return temConvertido ? "converted" : "non_converted";
}

function poolFor(category: AtendimentoOutcomeCategory): readonly string[] {
  if (category === "converted") return CONVERTED_MESSAGES;
  if (category === "non_converted") return NON_CONVERTED_MESSAGES;
  return MIXED_MESSAGES;
}

// Milestone 2E, section 6/7: in-memory only (never persisted — section 7),
// scoped to this browser tab's lifetime. A single re-roll on an immediate
// repeat is enough per the approved "keep this simple" direction — no
// weighted algorithm, no history table.
const lastShown: Record<AtendimentoOutcomeCategory, string | null> = {
  converted: null,
  non_converted: null,
  mixed: null,
};

function pickMessage(category: AtendimentoOutcomeCategory): string {
  const pool = poolFor(category);
  let message = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && message === lastShown[category]) {
    message = pool[Math.floor(Math.random() * pool.length)];
  }
  lastShown[category] = message;
  return message;
}

/**
 * Visual polish (presentation only — no effect on copy, classification, or
 * selection). sonner reads its toast background/border/text color and
 * corner radius from these exact CSS custom properties on a per-toast
 * basis (see `[data-sonner-toast][data-styled='true']` in sonner's own
 * stylesheet), so setting them here — rather than via Tailwind classes —
 * reliably overrides sonner's own default styling instead of racing it on
 * specificity. Converted/non-converted hues (152 green / 230 blue)
 * intentionally match this app's existing --success/--info design tokens
 * (see styles.css); mixed deliberately does NOT reuse --warning's amber
 * (hue 75) despite being the same "third category" pattern — amber already
 * means pending/deferred/needs-attention in this app, so mixed uses a
 * standalone soft lavender (hue 300) instead, chosen for this purpose only.
 * All three stay at a pastel lightness/chroma appropriate for a toast
 * background — light/pastel per spec, never saturated, and never the
 * destructive/red palette for the non-converted case.
 */
const CATEGORY_TOAST_STYLE: Record<AtendimentoOutcomeCategory, CSSProperties> = {
  // Converted — light green ("warm / positive / successful").
  converted: {
    "--normal-bg": "oklch(0.95 0.045 152)",
    "--normal-border": "oklch(0.82 0.10 152)",
    "--normal-text": "oklch(0.32 0.09 152)",
  } as CSSProperties,
  // Non-converted — light blue/calm ("encouraging / forward-looking /
  // neutral-positive"), deliberately not red/pink/gray so it never reads
  // as a failure state.
  non_converted: {
    "--normal-bg": "oklch(0.95 0.03 230)",
    "--normal-border": "oklch(0.82 0.08 230)",
    "--normal-text": "oklch(0.32 0.09 230)",
  } as CSSProperties,
  // Mixed — soft lavender/light purple ("positive / calm / distinct"),
  // NOT amber/warning: this app already uses amber/warning for pending
  // work, deferred checklists, and things requiring attention, so reusing
  // that family for a positive Mixed Atendimento would create semantic
  // confusion (stabilization fix). Lavender reads as celebratory and
  // clearly distinct from both the other two categories and from any
  // warning/destructive treatment elsewhere in the app.
  mixed: {
    "--normal-bg": "oklch(0.95 0.025 300)",
    "--normal-border": "oklch(0.82 0.07 300)",
    "--normal-text": "oklch(0.38 0.11 300)",
  } as CSSProperties,
};

// Shared modest size/prominence increase applied to every category — still
// restrained and professional, not a banner/celebration (section 4). Reuses
// this app's own --shadow-card value (styles.css) for the shadow so the
// toast's depth matches every other elevated surface in the app.
//
// fontSize deliberately references Tailwind's own --text-sm variable
// instead of a hardcoded px value — the accessibility "Texto maior"
// preference (src/lib/text-size.ts) works by overriding that exact
// variable on <html>, so this toast automatically participates in the
// same centralized typography scale instead of being a fixed-size
// exception (still restrained under the larger setting: --text-sm scales
// from 14px to ~15.8px, not "comically large").
const TOAST_PROMINENCE_STYLE: CSSProperties = {
  padding: "18px 20px",
  fontSize: "var(--text-sm)",
  fontWeight: 500,
  boxShadow: "0 4px 12px -2px rgb(15 23 42 / 0.06), 0 2px 6px -2px rgb(15 23 42 / 0.04)",
  ...({ "--border-radius": "14px" } as CSSProperties),
};

/**
 * Shows a transient positive-reinforcement toast for a successfully
 * completed Atendimento (section 1/16). Callers must only invoke this after
 * the backend has already confirmed success — this function never
 * participates in that decision and never throws into the caller, so a
 * selection issue can never affect the already-completed Atendimento
 * (section 5).
 */
export function showAtendimentoReinforcement(categorias: readonly MotivoCategoria[]): void {
  try {
    const category = classifyAtendimentoOutcome(categorias);
    toast(pickMessage(category), {
      style: { ...TOAST_PROMINENCE_STYLE, ...CATEGORY_TOAST_STYLE[category] },
    });
  } catch (error) {
    console.error("[atendimento-feedback] failed to show reinforcement toast:", error);
  }
}
