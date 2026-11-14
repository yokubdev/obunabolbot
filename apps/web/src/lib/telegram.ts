interface TgWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  HapticFeedback?: { notificationOccurred(t: "success" | "error"): void };
  openTelegramLink?(url: string): void;
}

export const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
export const insideTelegram = !!tg?.initData;

export function bootTelegram() {
  tg?.ready();
  tg?.expand();
  if (tg?.colorScheme === "light") document.documentElement.dataset.theme = "light";
}

export const haptic = (t: "success" | "error") => tg?.HapticFeedback?.notificationOccurred(t);

export function openLink(url: string) {
  if (tg?.openTelegramLink && url.startsWith("https://t.me/")) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}
