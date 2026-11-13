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

const TELEGRAM_REQUEST_TIMEOUT_MS = 10_000;

export type TelegramApiErrorKind =
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMITED"
  | "BOT_BLOCKED"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "API_ERROR"
  | "INVALID_RESPONSE";

export class TelegramApiError extends Error {
  constructor(
    public readonly kind: TelegramApiErrorKind,
    public readonly status: number | null = null,
    public readonly retryAfterSeconds: number | null = null
  ) {
    super(`Telegram API request failed: ${kind}`);
    this.name = "TelegramApiError";
  }
}

function getRetryAfterSeconds(
  value: Record<string, unknown>
): number | null {
  const parameters = value.parameters;

  if (
    parameters === null ||
    typeof parameters !== "object" ||
    Array.isArray(parameters)
  ) {
    return null;
  }

  const retryAfter = (
    parameters as Record<string, unknown>
  ).retry_after;

  return (
    typeof retryAfter === "number" &&
    Number.isSafeInteger(retryAfter) &&
    retryAfter >= 0
  )
    ? retryAfter
    : null;
}

async function telegramApi<T>(
  botToken: string,
  method: string,
  body?: Record<string, unknown>
): Promise<T> {
  if (!botToken) {
    throw new Error("Telegram bot token is required");
  }

  const signal = AbortSignal.timeout(
    TELEGRAM_REQUEST_TIMEOUT_MS
  );

  let response: Response;

  try {
    response = await fetch(
      `https://api.telegram.org/bot${botToken}/${method}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body ?? {}),
        signal
      }
    );
  } catch {
    throw new TelegramApiError(
      signal.aborted ? "TIMEOUT" : "NETWORK"
    );
  }

  let data: unknown;

  try {
    data = await response.json();
  } catch (error) {
    if (signal.aborted) {
      throw new TelegramApiError("TIMEOUT");
    }

    if (error instanceof SyntaxError) {
      throw new TelegramApiError(
        "INVALID_RESPONSE",
        response.status
      );
    }

    throw new TelegramApiError("NETWORK");
  }

  if (
    data === null ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    throw new TelegramApiError(
      "INVALID_RESPONSE",
      response.status
    );
  }

  const payload = data as Record<string, unknown>;

  if (typeof payload.ok !== "boolean") {
    throw new TelegramApiError(
      "INVALID_RESPONSE",
      response.status
    );
  }

  if (!response.ok || !payload.ok) {
    const status = response.status;

    if (status === 429) {
      throw new TelegramApiError(
        "RATE_LIMITED",
        status,
        getRetryAfterSeconds(payload)
      );
    }

    if (status === 403) {
      throw new TelegramApiError(
        "BOT_BLOCKED",
        status
      );
    }

    if (status === 400) {
      throw new TelegramApiError(
        "BAD_REQUEST",
        status
      );
    }

    if (status >= 500) {
      throw new TelegramApiError(
        "SERVER_ERROR",
        status
      );
    }

    throw new TelegramApiError(
      "API_ERROR",
      status
    );
  }

  if (
    !Object.prototype.hasOwnProperty.call(
      payload,
      "result"
    ) ||
    payload.result === null ||
    payload.result === undefined
  ) {
    throw new TelegramApiError(
      "INVALID_RESPONSE",
      response.status
    );
  }

  return payload.result as T;
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
