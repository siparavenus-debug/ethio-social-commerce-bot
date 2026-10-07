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
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!botToken) {
    throw new Error(
      "Telegram bot token is required"
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body ?? {})
      }
    );
  } catch {
    throw new Error(
      `Telegram API ${method} request failed`
    );
  }

  const data =
    (await response.json()) as TelegramApiResponse<T>;

  if (!response.ok || !data.ok || !data.result) {
    throw new Error(
      `Telegram API ${method} failed: ${
        data.description ??
        response.statusText
      }`
    );
  }

  return data.result;
}

export type TelegramBotIdentity = {
  id: number;
  username?: string;
  firstName: string;
};

export type TelegramWebhookInfo = {
  url: string;
  pendingUpdateCount: number;
  lastErrorDate?: number;
  lastErrorMessage?: string;
};

type TelegramGetMeResult = {
  id: number;
  is_bot: boolean;
  first_name: string;
  username?: string;
};

type TelegramGetWebhookInfoResult = {
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
};

export async function getTelegramBotIdentity(
  botToken: string
): Promise<TelegramBotIdentity> {
  const result =
    await telegramApi<TelegramGetMeResult>(
      botToken,
      "getMe"
    );

  if (
    !Number.isInteger(result.id) ||
    result.is_bot !== true ||
    !result.first_name
  ) {
    throw new Error(
      "Telegram getMe returned an invalid bot response"
    );
  }

  return {
    id: result.id,
    username: result.username,
    firstName: result.first_name
  };
}

export async function setTelegramWebhook(
  botToken: string,
  webhookUrl: string,
  webhookSecret: string
): Promise<void> {
  if (!webhookUrl) {
    throw new Error(
      "Telegram webhook URL is required"
    );
  }

  if (!webhookSecret) {
    throw new Error(
      "Telegram webhook secret is required"
    );
  }

  const result =
    await telegramApi<boolean>(
      botToken,
      "setWebhook",
      {
        url: webhookUrl,
        secret_token: webhookSecret
      }
    );

  if (result !== true) {
    throw new Error(
      "Telegram setWebhook returned an invalid response"
    );
  }
}

export async function deleteTelegramWebhook(
  botToken: string
): Promise<void> {
  const result =
    await telegramApi<boolean>(
      botToken,
      "deleteWebhook"
    );

  if (result !== true) {
    throw new Error(
      "Telegram deleteWebhook returned an invalid response"
    );
  }
}

export async function getTelegramWebhookInfo(
  botToken: string
): Promise<TelegramWebhookInfo> {
  const result =
    await telegramApi<TelegramGetWebhookInfoResult>(
      botToken,
      "getWebhookInfo"
    );

  if (
    typeof result.url !== "string" ||
    !Number.isInteger(
      result.pending_update_count
    )
  ) {
    throw new Error(
      "Telegram getWebhookInfo returned an invalid response"
    );
  }

  return {
    url: result.url,
    pendingUpdateCount:
      result.pending_update_count,
    lastErrorDate:
      result.last_error_date,
    lastErrorMessage:
      result.last_error_message
  };
}

export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string
) {
  const result =
    await telegramApi<{
      message_id?: number;
    }>(
      botToken,
      "sendMessage",
      {
        chat_id: chatId,
        text
      }
    );

  if (!result.message_id) {
    throw new Error(
      "Telegram sendMessage returned an invalid response"
    );
  }

  return String(result.message_id);
}

export async function sendTelegramPhoto(
  botToken: string,
  chatId: string,
  photo: string,
  caption?: string
) {
  const result =
    await telegramApi<{
      message_id?: number;
    }>(
      botToken,
      "sendPhoto",
      {
        chat_id: chatId,
        photo,
        ...(caption
          ? {
            caption
          }
          : {})
      }
    );

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
  botToken: string,
  fileId: string
): Promise<string> {
  const file =
    await telegramApi<TelegramFile>(
      botToken,
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
  botToken: string,
  filePath: string
): Promise<Buffer> {
  if (!botToken) {
    throw new Error(
      "Telegram bot token is required"
    );
  }

  let response: Response;

  try {
    response = await fetch(
      `https://api.telegram.org/file/bot${botToken}/${filePath}`
    );
  } catch {
    throw new Error(
      "Telegram file download request failed"
    );
  }

  if (!response.ok) {
    throw new Error(
      `Telegram file download failed with status ${response.status}`
    );
  }

  const arrayBuffer =
    await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}
