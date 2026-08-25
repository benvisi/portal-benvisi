export interface WhatsAppMessage {
  id: string;
  titulo: string;
  texto: string;
}

export interface WhatsAppMessageGroup {
  id: string;
  titulo: string;
  mensagens: WhatsAppMessage[];
}

// Operações, Milestone 4B: approved production WhatsApp templates, based on
// the approved Lacoste Manaus WhatsApp guidance document (Blueprint section
// 10 / 16.2). Copy is reproduced verbatim, including placeholders such as
// XXXXXX/PRODUTO/TAMANHO/COR/PREÇO/PRODUTO COMPLEMENTAR for employees to
// personalize after copying — do not rewrite or "improve" this Portuguese
// text without a new explicit content decision.
export const WHATSAPP_MESSAGE_GROUPS: WhatsAppMessageGroup[] = [
  {
    id: "mensagens-iniciais",
    titulo: "Mensagens iniciais",
    mensagens: [
      {
        id: "apresentacao-nome-cliente",
        titulo: "Se apresentar e identificar o nome do cliente",
        texto:
          "Olá! Agradecemos pelo seu contato e interesse na Lacoste. Meu nome é XXXXXX e estou à disposição para ajudar você.\n\nComo você se chama?",
      },
      {
        id: "cliente-sem-detalhes",
        titulo: "O cliente não informou detalhes do seu interesse",
        texto:
          "Poderia me informar qual produto específico você está procurando? Se possível, compartilhe também o tamanho e/ou a cor desejada.\n\nAssim, poderei verificar a disponibilidade na nossa loja e retornar com as informações rapidamente.",
      },
      {
        id: "cliente-informou-produto",
        titulo: "O cliente informou qual produto está procurando",
        texto:
          "Poderia me informar qual tamanho e/ou cor você gostaria? Assim, poderei verificar a disponibilidade na nossa loja e retornar com as informações rapidamente.",
      },
    ],
  },
  {
    id: "responder-informacoes-detalhadas",
    titulo: "Responder com informações detalhadas",
    mensagens: [
      {
        id: "identificou-produto",
        titulo: "Identificou o produto desejado",
        texto:
          "Olá! Tenho uma ótima notícia. Encontrei o produto que você estava procurando: uma PRODUTO, tamanho TAMANHO, cor COR. O preço é de R$ PREÇO. Posso reservar para você?",
      },
      {
        id: "nao-identificou-um-parecido",
        titulo: "Não identificou o produto desejado, mas temos um outro parecido",
        texto:
          "Infelizmente, não consegui identificar o produto exato que você mencionou. No entanto, temos uma opção semelhante que pode interessar você. Vou enviar as imagens do produto com o preço. Me avise se você gostou de alguma.",
      },
      {
        id: "nao-identificou-varios-parecidos",
        titulo: "Não identificou o produto desejado, mas temos uns outros parecidos",
        texto:
          "Infelizmente, não consegui identificar o produto exato que você mencionou. No entanto, temos algumas opções semelhantes que podem interessar você. Estarei enviando algumas imagens com os preços das opções. Me avise se você gostou de alguma.",
      },
      {
        id: "nao-identificou-nada-parecido",
        titulo: "Não identificou o produto desejado e não achou nada parecido",
        texto:
          "Infelizmente, não consegui identificar o produto que você mencionou. Posso ajudar com mais alguma coisa ou esclarecer outras dúvidas que você tenha?",
      },
    ],
  },
  {
    id: "sondar-interesse-outros-produtos",
    titulo: "Sondar interesse em outros produtos",
    mensagens: [
      {
        id: "oferecer-produtos-complementares",
        titulo: "Oferecer produtos complementares",
        texto:
          "Ótimo! O produto estará reservado para você por 3 dias. Quando você chegar na loja, é só me procurar.\n\nAlém disso, gostaria de sugerir PRODUTO COMPLEMENTAR, que vai combinar muito bem e pode enriquecer ainda mais sua experiência. O preço é de R$ PREÇO. Se você tiver interesse, posso verificar o seu tamanho e a cor da sua preferência. Pode ser?",
      },
      {
        id: "oferecer-mais-produtos",
        titulo: "Oferecer mais produtos",
        texto:
          "Ótimo! O produto estará reservado para você por 3 dias. Quando você chegar na loja, é só me procurar.\n\nVocê está interessado em mais alguma coisa? Posso ajudar com sugestões ou esclarecer dúvidas sobre outros produtos.",
      },
    ],
  },
  {
    id: "finalizar-venda",
    titulo: "Finalizar a venda",
    mensagens: [
      {
        id: "politica-pagamento",
        titulo: "Explicar a política de pagamento",
        texto:
          "Aceitamos os seguintes métodos de pagamento:\n\n• Pix (com 3% de desconto para clientes com cadastro na loja, não cumulativo com outros descontos)\n• Cartão de crédito (em até 3 parcelas sem juros para compras até R$499,99, e até 5 parcelas sem juros a partir de R$500,00)\n• Cartão de débito\n• Dinheiro\n\nSe você tiver alguma dúvida sobre as opções, estou à disposição para ajudar!",
      },
      {
        // Content-maintenance note (Milestone 4B closeout): formatting is
        // approved and correct as-is; the product owner wants to revisit
        // this template's wording later (see Blueprint section 16.2,
        // Milestone 4B). Do not rewrite the copy without that explicit
        // future content decision.
        id: "processo-envio-link",
        titulo: "Explicar o processo do envio do link",
        texto:
          "Oferecemos a opção de enviar um link para pagamento, que pode ser usado para pagamentos via Pix, cartão de crédito ou cartão de débito.\n\nApós você manifestar interesse em comprar, geramos um link com o valor total da sua compra. Você seguirá as instruções na tela para completar a transação. Assim que o pagamento for concluído, emitiremos a sua nota fiscal.\n\nPara agilizar o processo, ficaremos gratos se você puder nos enviar um print da confirmação do pagamento, pois o sistema pode levar um tempo para gerar a confirmação para nós.",
      },
      {
        id: "frete",
        titulo: "Frete",
        texto:
          "Atualmente, a entrega não está incluída, mas oferecemos algumas opções para você:\n\n1. Podemos agendar a entrega dos produtos via motoboy por uma taxa nominal de R$20 (para a maioria dos bairros da cidade).\n2. Você também pode solicitar um Uber Flash, e alguém da nossa equipe ficará feliz em entregar o produto ao motorista.\n\nComo alternativa, podemos segurar a mercadoria paga na loja até que você esteja pronto ou disponível para retirá-la.\n\nComo você prefere receber a sua compra?",
      },
    ],
  },
  {
    id: "finalizando-conversa",
    titulo: "Finalizando a conversa",
    mensagens: [
      {
        id: "oferecer-reserva",
        titulo: "Oferecer para fazer a reserva",
        texto:
          "Você gostaria de reservar algum dos itens que apresentamos até agora?\n\nEstou à disposição para ajudar com qualquer dúvida ou para finalizar a reserva.",
      },
      {
        id: "confirmar-reserva",
        titulo: "Confirmar a reserva",
        texto:
          "Ótimo! O produto estará reservado para você por 3 dias. Quando você chegar na loja, é só me procurar.",
      },
      {
        id: "oferecer-contato",
        titulo: "Oferecer para entrar em contato",
        texto:
          "Se você quiser, posso anotar o seu interesse e entrar em contato assim que a loja receber o produto. Pode ser?",
      },
      {
        id: "agradecer-contato",
        titulo: "Agradecer o contato e o interesse",
        texto:
          "Agradecemos pelo seu contato e interesse na Lacoste. Estamos à disposição para ajudar com qualquer pesquisa ou dúvida futura que você possa ter. Sinta-se à vontade para entrar em contato com nossa equipe a qualquer momento!",
      },
    ],
  },
  {
    id: "sobre-a-loja",
    titulo: "Sobre a loja",
    mensagens: [
      {
        id: "localizacao-horarios",
        titulo: "Localização e horários de funcionamento",
        texto:
          "A loja está localizada no Manauara Shopping - Piso Castanheiras (G6). O acesso mais próximo é pela garagem Azul (acesso pela Avenida Jornalista Umberto Calderaro, antiga Avenida Paraíba). A loja se encontra em frente à Brooksfield Junior, entre a Milon e a Live!\n\nOs horários de funcionamento são das 10h às 22h de segunda a sábado. Aos domingos, os horários são das 14h às 21h.",
      },
    ],
  },
];
