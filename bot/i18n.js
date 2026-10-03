// Bot texts in English (default) and Brazilian Portuguese.
// Telegram sends the user's language as an IETF tag in User.language_code
// (e.g. "pt-br"); it is optional, so we fall back to English.
// https://core.telegram.org/bots/features#language-support

export const LANGS = ["en", "pt"];

export function pickLang(code) {
  return typeof code === "string" && /^pt(?:$|[-_])/i.test(code.trim()) ? "pt" : "en";
}

const TEXTS = {
  en: {
    name: "Math DJ",
    tagline: "A formula becomes a song.",
    open: "Open",
    helpIntro:
      "Math DJ turns math into techno. In the app, each line is a formula y = f(t), where t is time: it plays and is drawn on the graph at the same time. Up to five formulas play together.",
    helpSong: "When your track is ready, tap the download button and I'll send you the MP3 right here.",
    helpCommands: [
      "/start — open Math DJ",
      "/draft — your saved drafts (up to 5)",
      "/help — this message",
    ],
    unknownCommand: "I don't know that command. Send /help to see what I can do, or open Math DJ below.",
    plainText: "I make music from formulas, inside the app. Open Math DJ below, or send /help.",
    drafts: "Drafts",
    noDrafts: "Nothing saved yet.",
    songCaption: "Your Math DJ track.",
    description:
      "Math DJ turns math into music. Write formulas y = f(t), play up to five at once as a techno track and get the song as an MP3 right here in the chat. Works in private chat only.",
    shortDescription: "A formula becomes a song.",
    commands: [
      { command: "start", description: "Open Math DJ" },
      { command: "help", description: "How it works and commands" },
      { command: "draft", description: "Your saved drafts" },
    ],
  },
  pt: {
    name: "Math DJ",
    tagline: "Uma fórmula vira música.",
    open: "Abrir",
    helpIntro:
      "O Math DJ transforma matemática em techno. No app, cada linha é uma fórmula y = f(t), em que t é o tempo: ela toca e aparece desenhada no gráfico ao mesmo tempo. Até cinco fórmulas tocam juntas.",
    helpSong: "Quando a faixa estiver pronta, toque no botão de baixar e eu te mando o MP3 aqui no chat.",
    helpCommands: [
      "/start — abrir o Math DJ",
      "/draft — seus rascunhos salvos (até 5)",
      "/help — esta mensagem",
    ],
    unknownCommand: "Não conheço esse comando. Mande /help para ver o que eu sei fazer, ou abra o Math DJ aqui embaixo.",
    plainText: "Eu faço música com fórmulas, lá no app. Abra o Math DJ aqui embaixo ou mande /help.",
    drafts: "Rascunhos",
    noDrafts: "Nada salvo ainda.",
    songCaption: "Sua faixa do Math DJ.",
    description:
      "O Math DJ transforma matemática em música. Escreva fórmulas y = f(t), toque até cinco juntas como uma faixa de techno e receba a música em MP3 aqui no chat. Funciona só no chat privado.",
    shortDescription: "Uma fórmula vira música.",
    commands: [
      { command: "start", description: "Abrir o Math DJ" },
      { command: "help", description: "Como funciona e comandos" },
      { command: "draft", description: "Seus rascunhos salvos" },
    ],
  },
};

export function texts(lang) {
  return TEXTS[lang] || TEXTS.en;
}
