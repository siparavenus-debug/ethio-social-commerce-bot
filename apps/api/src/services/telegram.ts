import { env } from "../config/env.js";

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type TelegramFile = {
  file_id: string;
  file_unique_id?: string;
  file_size?: number;
  file_path?: string;
};

async function telegramApi<T>(
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!env.telegramBotToken) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/bot${env.telegramBotToken}/${method}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(body ?? {})
    }
  );

  const data =
    (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(
      `Telegram API ${method} failed: ${data.description ?? response.statusText
      }`
    );
  }

  return data.result;
}

export async function sendTelegramMessage(
  chatId: string,
  text: string
) {
  const result =
    await telegramApi<{
      message_id?: number;
    }>("sendMessage", {
      chat_id: chatId,
      text
    });

  if (!result.message_id) {
    throw new Error(
      "Telegram sendMessage returned an invalid response"
    );
  }

  return String(result.message_id);
}

export async function sendTelegramPhoto(
  chatId: string,
  photo: string,
  caption?: string
) {
  const result =
    await telegramApi<{
      message_id?: number;
    }>("sendPhoto", {
      chat_id: chatId,
      photo,
      ...(caption
        ? {
          caption
        }
        : {})
    });

  if (!result.message_id) {
    throw new Error(
      "Telegram sendPhoto returned an invalid response"
    );
  }

  return String(result.message_id);
}

/**
 * Resolve a Telegram file_id to the downloadable
 * Telegram file path.
 */
export async function getTelegramFilePath(
  fileId: string
): Promise<string> {
  const file =
    await telegramApi<TelegramFile>(
      "getFile",
      {
        file_id: fileId
      }
    );

  if (!file.file_path) {
    throw new Error(
      "Telegram did not return a file path"
    );
  }

  return file.file_path;
}

/**
 * Download a Telegram file into memory.
 *
 * This is intended for receipt images and other
 * small customer-uploaded evidence.
 */
export async function downloadTelegramFile(
  filePath: string
): Promise<Buffer> {
  if (!env.telegramBotToken) {
    throw new Error(
      "TELEGRAM_BOT_TOKEN is not configured"
    );
  }

  const response = await fetch(
    `https://api.telegram.org/file/bot${env.telegramBotToken}/${filePath}`
  );

  if (!response.ok) {
    throw new Error(
      `Telegram file download failed with status ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}
