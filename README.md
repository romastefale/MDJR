# Math DJ Robot

Sintetizador matemático. Dez presets, fórmula escrita à mão, uma fórmula sorteada da biblioteca e outra equação gerada de verdade. Exporta MP3. Abre como Mini App do Telegram.

O site **não** é publicado da raiz do repositório. A Action [Deploy GitHub Pages](.github/workflows/pages.yml) publica só a pasta `web/`.

Mini App: https://romastefale.github.io/MDJR/

## Railway

O bot está em `bot/server.js`. No serviço Railway:

1. Root do repo, start `node bot/server.js` (ou `npm start`).
2. Variável obrigatória: `BOT_TOKEN` (o token do BotFather). Não commitar o token.
3. Variável opcional: `WEBAPP_URL`. Se ficar vazia, o bot abre `https://romastefale.github.io/MDJR/`.

`/start` manda o botão **Abrir Math DJ**. O menu do chat também abre o Mini App.

Healthcheck: `GET /health`.

## No sintetizador

- **TOCAR / PARAR** — espaço também, fora dos campos.
- **FÓRMULA ALEATÓRIA** — sorteia um preset e os parâmetros.
- **FÓRMULA NOVA** — inventa uma equação e entra no modo fórmula.
- **EXPORTAR MP3** — 8s, 16s ou 32s do patch atual.
- X tempo, Y tom, Z decay, W textura. A bits, B tremolo, G envelope extra, D saturação. No modo fórmula, `a b g d` entram na equação.
