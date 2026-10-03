// Telegram.WebApp when the page runs inside Telegram, otherwise null. telegram-web-app.js reports
// platform "unknown" in a normal browser. https://core.telegram.org/bots/webapps#initializing-mini-apps
export function telegramApp() {
  const webApp = window.Telegram?.WebApp;
  return !webApp || webApp.platform === "unknown" ? null : webApp;
}
