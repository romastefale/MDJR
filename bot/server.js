import http from "node:http";

const TOKEN = process.env.BOT_TOKEN || "";
const WEBAPP = (process.env.WEBAPP_URL || "https://romastefale.github.io/MDJR/").replace(/\/$/, "") + "/";
const PORT = Number(process.env.PORT || 3000);

async function api(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ ok: false, description: "json" }));
  if (!data.ok) console.error(method, data.description || data);
  return data;
}

function openKeyboard() {
  return {
    keyboard: [[{ text: "Abrir Math DJ", web_app: { url: WEBAPP } }]],
    resize_keyboard: true,
    is_persistent: true,
  };
}

function inlineKeyboard() {
  return {
    inline_keyboard: [[{ text: "Abrir o sintetizador", web_app: { url: WEBAPP } }]],
  };
}

async function setup() {
  await api("setMyCommands", {
    commands: [
      { command: "start", description: "Abrir o Math DJ" },
      { command: "app", description: "Abrir o Mini App" },
    ],
  });
  await api("setChatMenuButton", {
    menu_button: {
      type: "web_app",
      text: "Math DJ",
      web_app: { url: WEBAPP },
    },
  });
  await api("setMyShortDescription", {
    short_description: "Sintetizador matemático em Mini App",
  });
  await api("setMyDescription", {
    description:
      "Math DJ Robot toca fórmulas. Toque em Abrir Math DJ ou no botão do menu para entrar no sintetizador.",
  });
  console.log("menu do mini app apontando para", WEBAPP);
}

async function onMessage(message) {
  const text = message.text || "";
  if (!text.startsWith("/start") && !text.startsWith("/app")) return;
  const name = message.from?.first_name || "";
  await api("sendMessage", {
    chat_id: message.chat.id,
    text: `${name ? `Oi, ${name}. ` : ""}Math DJ Robot está pronto.\nAbra o sintetizador pelo botão abaixo. Dá para exportar MP3 e gerar uma fórmula nova.`,
    reply_markup: openKeyboard(),
  });
  await api("sendMessage", {
    chat_id: message.chat.id,
    text: "Se o teclado não aparecer, use este botão:",
    reply_markup: inlineKeyboard(),
  });
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const data = await api("getUpdates", {
        offset,
        timeout: 25,
        allowed_updates: ["message"],
      });
      for (const update of data.result || []) {
        offset = update.update_id + 1;
        if (update.message) await onMessage(update.message);
      }
    } catch (err) {
      console.error("poll", err instanceof Error ? err.message : err);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || "/").split("?")[0];
  if (path === "/" || path === "/health") {
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: true, service: "mdjr-bot", bot: Boolean(TOKEN), webapp: WEBAPP }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`mdjr-bot na porta ${PORT}`);
  if (!TOKEN) {
    console.error("BOT_TOKEN ausente. Crie a variável no Railway e faça redeploy.");
    return;
  }
  setup()
    .then(() => poll())
    .catch((err) => console.error("setup", err));
});
