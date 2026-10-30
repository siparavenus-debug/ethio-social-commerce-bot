
export interface MerchantActivationEmailInput {
    apiKey: string;
    fromEmail: string;
    recipientEmail: string;
    activationUrl: string;
    deliveryId: string;
  }

  export interface MerchantActivationEmailResult {
    providerMessageId: string;
  }

  export async function sendMerchantActivationEmail(
    input: MerchantActivationEmailInput
  ): Promise<MerchantActivationEmailResult> {

    let response: Response;

    try {
      response = await fetch(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${input.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key":
              `merchant-invitation/${input.deliveryId}`
          },
          body: JSON.stringify({
            from: input.fromEmail,
            to: [input.recipientEmail],
            subject: "Activate your merchant account",
            text: [
              "Your merchant account has been approved.",
              "",
              "Use the following link to activate your account:",
              input.activationUrl,
              "",
              "This invitation expires after 24 hours.",
              "If you did not expect this invitation, ignore this email."
            ].join("\n")
          }),
          signal: AbortSignal.timeout(30_000)
        }
      );
    } catch {
      throw new Error(
        "Resend email request failed due to a network error"
      );
    }


    if (!response.ok) {
      throw new Error(
        `Resend email request failed with HTTP ${response.status}`
      );
    }

    const result: unknown = await response.json();

    if (
      result === null ||
      typeof result !== "object" ||
      !("id" in result) ||
      typeof result.id !== "string" ||
      !result.id.trim()
    ) {
      throw new Error(
        "Resend returned an invalid email acceptance response"
      );
    }

    return {
      providerMessageId: result.id
    };
  }
