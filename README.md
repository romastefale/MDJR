<p align="center">
  <img src="header.png" alt="Math DJ Robot" width="100%">
</p>

# Math DJ Robot

**Uma fórmula vira música.**

Monte uma faixa escrevendo matemática. Cada linha é uma fórmula `y = f(x)`: ela toca e, ao mesmo tempo, aparece desenhada no gráfico. Até cinco fórmulas tocam juntas e formam a música.

**[Abrir o Math DJ Robot →](https://romastefale.github.io/MDJR/)**

## O que você pode fazer

- **Tocar e editar** cinco fórmulas ao mesmo tempo e ver cada uma desenhada no gráfico
- **Sortear uma voz nova** para qualquer linha com *Generate*: são cinco cartões, de bateria e de baixo, com 100 vozes cada
- **Ajustar o BPM** (de 80 a 180) e o **volume** de cada linha
- **Escolher a duração:** 0:30, 1:00, 2:00, 5:00, 10:00 ou 20:00
- **Baixar em MP3:** no navegador sai como arquivo, e no Telegram o bot envia o arquivo no chat
- **Alternar** entre tema claro e escuro, ou **silenciar** tudo pelo menu

## No Telegram

Abra o Math DJ pelo bot e o app retoma de onde você parou. Você pode guardar até **5 rascunhos**, e o comando `/draft` mostra a lista. O `/help` explica como funciona.

O bot funciona só no **chat privado**: em grupos e canais ele não responde e sai. Os textos aparecem em português para quem usa o Telegram em português e em inglês para os demais.

## Para publicar

O site fica em `web/` e é publicado no GitHub Pages pela Action. O bot e a API ficam em `bot/server.js` (Node 20 ou mais novo), pensados para o Railway.

### Variáveis

- `BOT_TOKEN` (obrigatória): o token do bot
- `PUBLIC_URL` (opcional): o endereço público HTTPS do servidor. Sem ela, o servidor usa o `RAILWAY_PUBLIC_DOMAIN` que o Railway cria sozinho, e por fim `https://mdjr.up.railway.app`
- `WEBHOOK_SECRET` (opcional): o segredo do webhook, de 1 a 256 caracteres `A-Z a-z 0-9 _ -`. Sem ela, o servidor deriva um segredo fixo a partir do token, que não muda entre deploys
- `USE_POLLING=1` (só para desenvolvimento local): apaga o webhook e recebe as mensagens por `getUpdates`
- Monte um volume em `/mdjr-volume` para guardar o progresso e os rascunhos

No Railway basta o `BOT_TOKEN` e o volume. Não é preciso criar outra variável.

### Webhook

O bot recebe as mensagens pelo [webhook oficial](https://core.telegram.org/bots/api#setwebhook), e não mais por polling. A cada inicialização, o servidor:

1. chama `setWebhook` com `https://<endereço público>/telegram/webhook`, o `secret_token` e `allowed_updates` só com `message` e `my_chat_member`;
2. não descarta as mensagens pendentes (`drop_pending_updates` fica desligado), para responder quem escreveu durante o deploy.

Na rota `/telegram/webhook`, o servidor confere o cabeçalho `X-Telegram-Bot-Api-Secret-Token` antes de tudo e responde 401 se ele não bater. Também aceita só `POST` com JSON de até 1 MB. Ele responde 200 na hora e trata a mensagem em seguida, então um erro no tratamento nunca faz o Telegram reenviar a mesma mensagem.

No `SIGTERM` (deploy novo), o servidor para de aceitar conexões, espera as mensagens em andamento (até 8 s) e sai. O webhook continua apontando para o mesmo endereço, que o próximo deploy assume.

Se o servidor não encontrar um endereço público HTTPS (por exemplo, rodando no seu computador), ele avisa no log e não recebe mensagens. Para testar o bot localmente com um token de teste, rode `USE_POLLING=1 BOT_TOKEN=... npm start`. Isso apaga o webhook desse bot, então use um bot de teste, não o de produção.

### Logs

Os logs nunca mostram o `BOT_TOKEN` nem o segredo do webhook, nem em parte. Todas as linhas passam por `bot/log.js`, que troca por `[redacted]`:

- o token e o segredo, inclusive codificados em URL;
- qualquer trecho deles com 8 caracteres ou mais;
- qualquer `bot<números>:<texto>` (o formato das URLs da Bot API).

Erros mostram a mensagem e a causa, mas nunca a URL completa da requisição, os cabeçalhos ou o conteúdo do `setWebhook`. Falhas que derrubam o processo também passam pela mesma limpeza.

### Testes

`npm test` roda os testes com `node:test`, sem dependências, sem token e sem falar com o Telegram. `npm run check` confere a sintaxe.

Os testes sobem o servidor de verdade numa porta local e conversam com ele por HTTP. Do outro lado fica um Telegram falso e rígido (`test/fake-bot-api.js`): ele confere cada chamada contra a tabela `test/bot-api-schema.js`, copiada da documentação oficial da Bot API 10.3, e reprova o teste se aparecer método desconhecido, parâmetro a mais, parâmetro faltando, tipo errado ou valor fora do limite, inclusive no upload do MP3. Cada teste diz de onde vem o comportamento esperado: a seção da documentação oficial ou uma decisão do Pi.

## Licença

MIT. Veja o arquivo [LICENSE](LICENSE).
