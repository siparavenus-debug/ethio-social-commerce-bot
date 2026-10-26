import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(
  new URL("../src/App.tsx", import.meta.url),
  "utf8"
);

describe("merchant authenticated session validation UI contract", () => {
  it("keeps dashboard tab authorization separate from data initialization", () => {
    const normalizedSource = appSource.replace(/\s+/g, " ");

    const effects = normalizedSource.matchAll(
      /useEffect\(\(\) => \{(?:(?!useEffect\().)*?\}, \[[^\]]*\]\);/g
    );

    const effectBodies = [...effects].map((match) => match[0]);

    const authorizationEffect = effectBodies.find((effect) =>
      effect.includes('!canReviewPayments && activeTab === "payments"')
    );

    const initializationEffect = effectBodies.find((effect) =>
      effect.includes("refreshDashboardOnEffect();")
    );

    expect(authorizationEffect).toBeDefined();
    expect(initializationEffect).toBeDefined();

    expect(authorizationEffect).not.toBe(initializationEffect);
    expect(authorizationEffect).toContain("activeTab");
    expect(initializationEffect).not.toContain("activeTab");
  });
  it("redirects unauthorized dashboard tabs to orders", () => {
    const normalizedSource = appSource.replace(/\s+/g, " ");

    for (const [permission, tab] of [
      ["canReviewPayments", "payments"],
      ["canViewBilling", "billing"],
      ["canManageUsers", "users"]
    ]) {
      expect(normalizedSource).toContain(
        `!${permission} && activeTab === "${tab}"`
      );
    }

    expect(normalizedSource).toContain(
      'setActiveTab("orders");'
    );
  });
  it("guards stored-session validation against stale effect responses", () => {
    const normalizedSource = appSource.replace(/\s+/g, " ");

    expect(normalizedSource).toContain(
      "let cancelled = false;"
    );
    expect(normalizedSource).toContain(
      "if (cancelled) { return; }"
    );
    expect(normalizedSource).toContain(
      "cancelled = true;"
    );
  });
  it("revalidates a stored merchant session against the authenticated identity endpoint", () => {
    expect(appSource).toContain(
      "async function validateStoredAuth()"
    );
    expect(appSource).toContain(
      "`${API_BASE_URL}/auth/me`"
    );
    expect(appSource).toContain(
      "Authorization: `Bearer ${validatedToken}`"
    );
    expect(appSource).toContain(
      "saveAuth({"
    );
    expect(appSource).toContain(
      "user: data.user"
    );
  });

  it("does not load merchant dashboard data before stored authentication is validated", () => {
    expect(appSource).toContain(
      "authValidated,"
    );
    expect(appSource).toContain(
      "setAuthValidated"
    );
    expect(appSource).toContain(
      "() => !auth?.token"
    );
    const normalizedSource =
    appSource.replace(
      /\s+/g,
      " "
    );

    expect(normalizedSource).toContain(
      "if (!authValidated) { return; }"
    );

    const validationGuard =
      normalizedSource.indexOf(
        "if (!authValidated) { return; }"
    );

    const dashboardRefresh =
      normalizedSource.indexOf(
        "refreshDashboardOnEffect();",
        validationGuard
      );

    expect(normalizedSource).toContain(
      "const refreshDashboardOnEffect = useEffectEvent(() => { void refreshDashboard(); });"
    );

    expect(validationGuard).toBeGreaterThan(
      -1
    );
    expect(dashboardRefresh).toBeGreaterThan(
      validationGuard
    );
  });

  it("replaces cached merchant identity with the authoritative server identity", () => {
    const validationStart =
      appSource.indexOf(
        "async function validateStoredAuth()"
      );

    const loginStart =
      appSource.indexOf(
        "async function login()",
        validationStart
      );

    const validationSource =
      appSource.slice(
        validationStart,
        loginStart
      );

    expect(validationSource).toContain(
      "saveAuth({"
    );
    expect(validationSource).toContain(
      "token: validatedToken"
    );
    expect(validationSource).toContain(
      "user: data.user"
    );
    expect(validationSource).not.toContain(
      "user: auth.user"
    );
  });

  it("clears an invalid stored session instead of loading cached merchant data", () => {
    const validationStart =
      appSource.indexOf(
        "async function validateStoredAuth()"
      );

    const loginStart =
      appSource.indexOf(
        "async function login()",
        validationStart
      );

    const validationSource =
      appSource.slice(
        validationStart,
        loginStart
      );

    expect(validationSource).toContain(
      "!response.ok ||"
    );
    expect(validationSource).toContain(
      "!data?.user"
    );
    expect(validationSource).toContain(
      "logout();"
    );
  });

  it("does not render the merchant dashboard before stored authentication is validated", () => {
    const normalizedSource =
      appSource.replace(
        /\s+/g,
        " "
      );

    const renderGuard =
      normalizedSource.indexOf(
        "if (!authValidated) { return ("
      );

    const dashboardReturn =
      normalizedSource.indexOf(
        "<main style={styles.page}>",
        renderGuard
      );

    expect(renderGuard).toBeGreaterThan(
      -1
    );
    expect(normalizedSource).toContain(
      "Validating your session..."
    );
    expect(dashboardReturn).toBeGreaterThan(
      renderGuard
    );
  });
});
