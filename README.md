# Math DJ Robot

`y = f(x)`. Dez fórmulas na mesma música, até 20:00. MP3 no navegador; no Telegram, o bot manda o arquivo no chat.

O site não sai da raiz. A Action [Deploy GitHub Pages](.github/workflows/pages.yml) publica só `web/`.

https://romastefale.github.io/MDJR/

## Railway

`bot/server.js`. Variável obrigatória: `BOT_TOKEN`. Opcional: `WEBAPP_URL` (padrão o Pages) e `PUBLIC_URL` (padrão `https://mdjr.up.railway.app`). O Mini App envia o MP3 para `POST /song`. O bot valida o `initData` e manda o anexo no chat.

Healthcheck: `GET /health`.
