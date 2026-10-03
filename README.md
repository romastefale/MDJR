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

Abra o Math DJ pelo bot e o app retoma de onde você parou. Você pode guardar até **5 rascunhos**, e o comando `/draft` mostra a lista.

## Para publicar

O site fica em `web/` e é publicado no GitHub Pages pela Action. O bot e a API ficam em `bot/server.js` (Node 20 ou mais novo), pensados para o Railway.

- `BOT_TOKEN` (obrigatória): o token do bot
- `PUBLIC_URL` (opcional): o endereço público do servidor, por padrão `https://mdjr.up.railway.app`
- Monte um volume em `/mdjr-volume` para guardar o progresso e os rascunhos

## Licença

MIT. Veja o arquivo [LICENSE](LICENSE).
