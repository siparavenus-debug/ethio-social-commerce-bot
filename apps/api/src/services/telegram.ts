import { env } from "../config/env.js";

export async function sendTelegramMessage(
  chatId: string,
  text: string
) {
  if (!env.telegramBotToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.telegramBotToken}/sendMessage`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text
      })
    }
  );

  if (!response.ok) {
    const errorText = await response.text();

    throw new Error(
      `Telegram sendMessage failed with status ${response.status}: ${errorText}`
    );
  }

  const body = (await response.json()) as {
    ok?: boolean;
    result?: {
      message_id?: number;
    };
  };

  if (!body.ok || !body.result?.message_id) {
    throw new Error(
      "Telegram sendMessage returned an invalid response"
    );
  }

  return String(body.result.message_id);
}
