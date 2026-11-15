interface TgWebApp {
  initData: string;
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  HapticFeedback?: { notificationOccurred(t: "success" | "error"): void };
  openTelegramLink?(url: string): void;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  /** Bot API 6.9+. The phone itself reaches the bot as a contact message; the callback only says yes or no. */
  requestContact?(cb?: (shared: boolean) => void): void;
}

export const tg: TgWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp;
export const insideTelegram = !!tg?.initData;

export function bootTelegram() {
  tg?.ready();
  tg?.expand();
  // Without this, scrolling up inside a long form drags the whole Mini App down to close it.
  tg?.disableVerticalSwipes?.();
  if (tg?.colorScheme === "light") document.documentElement.dataset.theme = "light";
}

export const haptic = (t: "success" | "error") => tg?.HapticFeedback?.notificationOccurred(t);

export function openLink(url: string) {
  if (tg?.openTelegramLink && url.startsWith("https://t.me/")) tg.openTelegramLink(url);
  else window.open(url, "_blank");
}

/** Asks Telegram to share the user's phone with the bot. Resolves false outside Telegram or when declined. */
export const requestPhone = () =>
  new Promise<boolean>((resolve) => (tg?.requestContact ? tg.requestContact((ok) => resolve(ok)) : resolve(false)));
