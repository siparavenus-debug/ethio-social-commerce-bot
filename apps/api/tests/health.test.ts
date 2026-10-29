import { describe, expect, it } from "vitest";

const API_BASE_URL = "http://127.0.0.1:3100";

describe("API health", () => {
  it("reports that the API is healthy", async () => {
    const response = await fetch(
      `${API_BASE_URL}/health`
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data).toEqual({
      status: "ok",
      service: "api"
    });
  });

  it("reports that the database is connected", async () => {
    const response = await fetch(
      `${API_BASE_URL}/health/db`
    );

    expect(response.status).toBe(200);

    const data = await response.json();

    expect(data).toEqual({
      status: "ok",
      service: "api",
      database: "connected"
    });
  });
});