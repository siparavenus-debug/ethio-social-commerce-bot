
import {
    afterEach,
    describe,
    expect,
    it,
    vi
} from "vitest";

import {
    sendMerchantActivationEmail
} from "../src/services/resend-email.js";

describe("Resend merchant activation email", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("sends an activation invitation with a stable idempotency key", async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    id: "email_test_123"
                }),
                {
                    status: 200,
                    headers: {
                        "content-type": "application/json"
                    }
                }
            )
        );

        vi.stubGlobal("fetch", fetchMock);

        const result = await sendMerchantActivationEmail({
            apiKey: "re_test_fake_key",
            fromEmail: "onboarding@example.test",
            recipientEmail: "owner@example.test",
            activationUrl:
                "https://example.test/activate-owner?token=test-token",
            deliveryId: "delivery_test_123"
        });

        expect(result).toEqual({
            providerMessageId: "email_test_123"
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [url, options] =
            fetchMock.mock.calls[0]!;

        expect(url).toBe(
            "https://api.resend.com/emails"
        );

        expect(options.method).toBe("POST");

        expect(options.headers).toMatchObject({
            Authorization: "Bearer re_test_fake_key",
            "Content-Type": "application/json",
            "Idempotency-Key":
                "merchant-invitation/delivery_test_123"
        });

        const body = JSON.parse(options.body);

        expect(body.from).toBe(
            "onboarding@example.test"
        );

        expect(body.to).toEqual([
            "owner@example.test"
        ]);

        expect(JSON.stringify(body)).toContain(
            "https://example.test/activate-owner?token=test-token"
        );
    });

    it("rejects provider failures without exposing credentials or activation tokens", async () => {
        const apiKey = "re_test_sensitive_api_key";
        const activationToken = "sensitive-owner-token";

        const fetchMock = vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    message: `Rejected ${apiKey} ${activationToken}`
                }),
                {
                    status: 429,
                    headers: {
                        "content-type": "application/json"
                    }
                }
            )
        );

        vi.stubGlobal("fetch", fetchMock);

        let capturedError: unknown;

        try {
            await sendMerchantActivationEmail({
                apiKey,
                fromEmail: "onboarding@example.test",
                recipientEmail: "owner@example.test",
                activationUrl:
                    `https://example.test/activate-owner?token=${activationToken}`,
                deliveryId: "delivery_failure_123"
            });
        } catch (error) {
            capturedError = error;
        }

        expect(capturedError).toBeInstanceOf(Error);

        const message = (capturedError as Error).message;

        expect(message).toContain("429");
        expect(message).not.toContain(apiKey);
        expect(message).not.toContain(activationToken);
    });


it("handles network failures without exposing sensitive information", async () => {
    const apiKey = "re_test_network_secret";
    const activationToken = "private-activation-token";

    const fetchMock = vi.fn().mockRejectedValue(
      new Error(
        `Network failure involving ${apiKey} and ${activationToken}`
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    let capturedError: unknown;

    try {
      await sendMerchantActivationEmail({
        apiKey,
        fromEmail: "onboarding@example.test",
        recipientEmail: "owner@example.test",
        activationUrl:
          `https://example.test/activate-owner?token=${activationToken}`,
        deliveryId: "delivery_network_123"
      });
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toBeInstanceOf(Error);

    const message = (capturedError as Error).message;

    expect(message).not.toContain(apiKey);
    expect(message).not.toContain(activationToken);
    expect(message).toContain("Resend");
  });


it("rejects malformed provider responses without reporting success", async () => {
    const malformedResponses = [
      new Response("not-json", {
        status: 200
      }),
      new Response(
        JSON.stringify({}),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      ),
      new Response(
        JSON.stringify({
          id: ""
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    ];

    for (const response of malformedResponses) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response)
      );

      await expect(
        sendMerchantActivationEmail({
          apiKey: "re_test_fake_key",
          fromEmail: "onboarding@example.test",
          recipientEmail: "owner@example.test",
          activationUrl:
            "https://example.test/activate-owner?token=test-token",
          deliveryId: "delivery_malformed_123"
        })
      ).rejects.toThrow();
    }
  });

  it("configures a 30-second timeout for Resend requests", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ id: "email_timeout_test" }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      )
    );

    vi.stubGlobal("fetch", fetchMock);

    await sendMerchantActivationEmail({
      apiKey: "re_test_fake_key",
      fromEmail: "onboarding@example.test",
      recipientEmail: "owner@example.test",
      activationUrl:
        "https://example.test/activate-owner?token=test-token",
      deliveryId: "delivery_timeout_test"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, options] = fetchMock.mock.calls[0]!;

    expect(options.signal).toBeInstanceOf(AbortSignal);

    expect(options.signal.aborted).toBe(false);

    expect(timeoutSpy).toHaveBeenCalledWith(30_000);

    timeoutSpy.mockRestore();
  });
});
