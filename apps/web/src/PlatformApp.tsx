import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  platformFetch,
  platformRequest,
  PlatformApiError,
  PLATFORM_SESSION_KEY
} from "./platform-api";

import "./platform.css";

type Row = { id: string;[key: string]: unknown };
type PlatformRole = "OWNER" | "ADMIN" | "STAFF";

type User = {
  id: string;
  email: string;
  displayName?: string | null;
  role: PlatformRole;
};

type Plan = Row & { name: string; code: string; isActive: boolean };
type Subscription = Row & {
  status: string;
  plan: Plan;
  billingInterval?: string;
  priceSnapshot?: string;
  commissionRateSnapshot?: string;
  currency?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
};
type Merchant = Row & {
  name: string;
  currency?: string;
  phone?: string | null;
  alternatePhone?: string | null;
  address?: string | null;
  createdAt?: string;
  accountStatus: string;
  accountSuspensionReason?: string | null;
  accountSuspendedAt?: string | null;
  subscription: Subscription | null;
};
type MerchantOnboardingApplication = Row & {
  status:
    | "PENDING_APPROVAL"
    | "APPROVED"
    | "REJECTED"
    | "DISCARDED";
  name: string;
  currency: "ETB";
  phone: string;
  alternatePhone: string | null;
  address: string | null;
  telegramUsername: string | null;
  ownerEmail: string;
  ownerDisplayName: string | null;
  createdById: string;
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  merchantId: string | null;
  createdAt: string;
  updatedAt: string;
};
type View =
  | "Merchants"
  | "Merchant Onboarding"
  | "Invitation Deliveries"
  | "Billing Work"
  | "Plans"
  | "Overdue"
  | "Revenue"
  | "Audit"
  | "Operators";

type BillingWorkTab =
  | "draft"
  | "awaiting-payment"
  | "review"
  | "resolved";

type BillingWorkSummary = {
  pending: {
    draftInvoices: number;
    awaitingPayment: number;
    paymentReview: number;
    total: number;
  };
  resolvedToday: {
    verified: number;
    rejected: number;
    total: number;
  };
};

type RevenueCurrencySummary = {
  currency: string;
  subscriptionAmount: string;
  commissionAmount: string;
  totalAmount: string;
};

type RevenuePeriodMode =
  | "month"
  | "year"
  | "custom";

type RevenuePeriodSummary = {
  periodStart: string;
  periodEnd: string;
  currencies: RevenueCurrencySummary[];
};

type OverdueCurrencySummary = {
  currency: string;
  invoiceCount: number;
  totalAmount: string;
};

type OverduePeriodSummary = {
  periodStart: string;
  periodEnd: string;
  currencies: OverdueCurrencySummary[];
};

function currentUtcMonth(): string {
  const now = new Date();

  return `${now.getUTCFullYear()}-${String(
    now.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

function revenueMonthRange(
  month: string
): {
  start: string;
  end: string;
} {
  const [year, monthNumber] =
    month.split("-").map(Number);

  const periodStart =
    new Date(
      Date.UTC(
        year,
        monthNumber - 1,
        1
      )
    );

  const periodEnd =
    new Date(
      Date.UTC(
        year,
        monthNumber,
        1
      )
    );

  return {
    start:
      periodStart
        .toISOString()
        .slice(0, 10),
    end:
      periodEnd
        .toISOString()
        .slice(0, 10)
  };
}

function revenueYearRange(
  year: string
): {
  start: string;
  end: string;
} {
  return {
    start: `${year}-01-01`,
    end: `${Number(year) + 1}-01-01`
  };
}

function nextUtcDate(
  date: string
): string {
  const next =
    new Date(
      `${date}T00:00:00.000Z`
    );

  next.setUTCDate(
    next.getUTCDate() + 1
  );

  return next
    .toISOString()
    .slice(0, 10);
}

type Field = { name: string; label: string; type?: string; optional?: boolean; options?: string[]; value?: unknown };
type Action = { title: string; path: string; method: string; fields: Field[]; note?: string; transform?: (values: Record<string, unknown>) => unknown };
const transitions: Record<string, string[]> = { TRIAL: ["ACTIVE", "CANCELLED"], ACTIVE: ["PAST_DUE", "CANCELLED"], PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELLED"], SUSPENDED: ["ACTIVE", "CANCELLED"], CANCELLED: [] };
const statuses = Object.keys(transitions);
const field = (name: string, label: string, type = "text", optional = false): Field => ({ name, label, type, optional });
const dateFields = (start: string, end: string): Field[] => [field(start, "Period start (local time)", "datetime-local"), field(end, "Period end (local time)", "datetime-local")];
const display = (value: unknown): string => value == null ? "—" : typeof value === "object" ? JSON.stringify(value, null, 2) : String(value);
const label = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase());

function rowMerchantId(
  row: Row
): string {
  const merchant = row.merchant;

  return (
    merchant &&
      typeof merchant === "object" &&
      "id" in merchant &&
      typeof merchant.id === "string"
      ? merchant.id
      : ""
  );
}

function billingWorkRows(
  rows: Row[]
): Row[] {
  return rows.map(row => {
    const merchant = row.merchant;
    const invoice = row.invoice;

    const merchantName =
      merchant &&
        typeof merchant === "object" &&
        "name" in merchant &&
        typeof merchant.name === "string"
        ? merchant.name
        : "—";

    const invoiceNumber =
      invoice &&
        typeof invoice === "object" &&
        "invoiceNumber" in invoice &&
        typeof invoice.invoiceNumber === "string"
        ? invoice.invoiceNumber
        : typeof row.invoiceNumber === "string"
          ? row.invoiceNumber
          : "—";

    return {
      ...row,
      merchantName,
      invoiceNumber
    };
  });
}

function ModalBackdrop({ close, label }: { close: () => void; label: string }) {
  return (
    <button
      type="button"
      className="pa-modal-backdrop-button"
      aria-label={label}
      onClick={close}
    />
  );
}

function RecordModal({ row, close }: { row: Row; close: () => void }) {
  return <div className="pa-modal-backdrop"><ModalBackdrop close={close} label="Close record dialog backdrop" /><section className="pa-modal pa-record-modal" role="dialog" aria-modal="true"><div className="pa-modal-head"><div><p className="pa-eyebrow">FULL RECORD</p><h2>{String(row.name || row.invoiceNumber || row.id)}</h2></div><button type="button" className="pa-icon-button" onClick={close} aria-label="Close">×</button></div><dl className="pa-record-grid">{Object.entries(row).map(([k, v]) => <div key={k}><dt>{label(k)}</dt><dd>{typeof v === "object" && v !== null ? <pre>{JSON.stringify(v, null, 2)}</pre> : display(v)}</dd></div>)}</dl></section></div>;
}

function Table({ rows, columns, actions }: { rows: Row[]; columns: string[]; actions?: (row: Row) => ReactNode }) {
  const [record, setRecord] = useState<Row | null>(null);
  if (!rows.length) return <p className="pa-empty">No records found.</p>;
  return <><div className="pa-table"><table><thead><tr>{columns.map(c => <th key={c}>{label(c)}</th>)}<th>Actions</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}>{columns.map(c => <td key={c}>{display(row[c])}</td>)}<td><div className="pa-row-actions">{actions?.(row)}<button type="button" className="pa-link-button" onClick={() => setRecord(row)}>Full record</button></div></td></tr>)}</tbody></table></div>{record && <RecordModal row={record} close={() => setRecord(null)} />}</>;
}

function ActionForm({ action, busy, submit, close }: { action: Action; busy: boolean; submit: (body: unknown) => Promise<void>; close: () => void }) {
  const [error, setError] = useState("");
  const formId = useId();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const data = new FormData(event.currentTarget);
    try {
      const values: Record<string, unknown> = {};
      for (const f of action.fields) {
        const input =
          String(
            data.get(f.name) ?? ""
          );

        const raw =
          f.type === "password"
            ? input
            : input.trim();
        if (!raw && f.optional) continue;
        values[f.name] = f.type === "datetime-local" ? new Date(raw).toISOString() : f.type === "json" ? JSON.parse(raw) : raw;
      }
      for (const [start, end] of [["periodStart", "periodEnd"], ["currentPeriodStart", "currentPeriodEnd"], ["billingPeriodStart", "billingPeriodEnd"]]) {
        if (values[start] && values[end] && String(values[start]) >= String(values[end])) throw new Error("Period end must be after period start.");
      }
      await submit(action.transform ? action.transform(values) : values);
    } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); }
  }
  return <div className="pa-modal-backdrop"><ModalBackdrop close={close} label="Close action dialog backdrop" /><section className="pa-modal pa-action-modal" role="dialog" aria-modal="true" aria-label={action.title}><div className="pa-modal-head"><div><p className="pa-eyebrow">PLATFORM ACTION</p><h2>{action.title}</h2></div><button type="button" className="pa-icon-button" onClick={close} aria-label="Close">×</button></div><p>{action.note || "Review these details before submitting. The server validates this operation."}</p><form onSubmit={onSubmit}><fieldset disabled={busy}>{action.fields.map(f => <label key={f.name} htmlFor={`${formId}-${f.name}`}>{f.label}{f.optional ? " (optional)" : ""}{f.options ? <select id={`${formId}-${f.name}`} name={f.name} defaultValue={String(f.value ?? f.options[0])}>{f.options.map(v => <option key={v}>{v}</option>)}</select> : f.type === "json" ? <textarea id={`${formId}-${f.name}`} name={f.name} required={!f.optional} defaultValue={f.value == null ? "" : JSON.stringify(f.value, null, 2)} /> : <input id={`${formId}-${f.name}`} name={f.name} type={f.type || "text"} step="any" min={f.type === "number" ? "0" : undefined} required={!f.optional} defaultValue={f.value == null ? "" : String(f.value)} />}</label>)}{error && <p role="alert" className="pa-error">{error}</p>}<div className="pa-buttons"><button type="submit">{busy ? "Submitting…" : "Confirm and submit"}</button><button type="button" onClick={close}>Cancel</button></div></fieldset></form></section></div>;
}

export default function PlatformApp() {
  const [token, setToken] = useState(() => { try { return sessionStorage.getItem(PLATFORM_SESSION_KEY) || ""; } catch { return ""; } });
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(!!token);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [
    changingPassword,
    setChangingPassword
  ] = useState(false);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<View>("Merchants");
  const [
    invitationDeliveryStatus,
    setInvitationDeliveryStatus
  ] = useState("REVIEW_REQUIRED");
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [onboardingApplications, setOnboardingApplications] =
    useState<MerchantOnboardingApplication[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [selected, setSelected] = useState("");
  const [merchant, setMerchant] = useState<Merchant | null>(null);
  const [ledger, setLedger] = useState("invoices");
  const [billingWorkTab, setBillingWorkTab] =
    useState<BillingWorkTab>("review");
  const [billingWorkSummary, setBillingWorkSummary] =
    useState<BillingWorkSummary | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [revenueSummary, setRevenueSummary] =
    useState<RevenuePeriodSummary | null>(null);
  const [revenuePeriodMode, setRevenuePeriodMode] =
    useState<RevenuePeriodMode>("month");
  const [revenueMonth, setRevenueMonth] =
    useState(currentUtcMonth);
  const [revenueYear, setRevenueYear] =
    useState(() =>
      String(new Date().getUTCFullYear())
    );
  const [revenueCustomStart, setRevenueCustomStart] =
    useState("");
  const [revenueCustomEnd, setRevenueCustomEnd] =
    useState("");
  const [overdueSummary, setOverdueSummary] =
    useState<OverduePeriodSummary | null>(null);
  const [overduePeriodMode, setOverduePeriodMode] =
    useState<RevenuePeriodMode>("month");
  const [overdueMonth, setOverdueMonth] =
    useState(currentUtcMonth);
  const [overdueYear, setOverdueYear] =
    useState(() =>
      String(new Date().getUTCFullYear())
    );
  const [overdueCustomStart, setOverdueCustomStart] =
    useState("");
  const [overdueCustomEnd, setOverdueCustomEnd] =
    useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [planFilter, setPlanFilter] = useState("ALL");
  const [billingFilter, setBillingFilter] = useState("ALL");
  const [createdFilter, setCreatedFilter] = useState("ALL");
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const session = useRef(0);
  const logout = useCallback(() => {
    session.current++; try { sessionStorage.removeItem(PLATFORM_SESSION_KEY); } catch { /* Memory session still clears. */ }
    setToken(""); setUser(null); setChecking(false); setRows([]); setMerchants([]); setOnboardingApplications([]); setPlans([]); setMerchant(null); setSelected(""); setAction(null); setNotice(""); setBusy(false);
  }, []);
  const fail = useCallback((e: unknown) => {
    if (e instanceof PlatformApiError && e.status === 401) logout();
    setError(e instanceof Error ? e.message : "Unable to connect to the API.");
  }, [logout]);
  async function openSettlementEvidence(
    settlement: Row
  ) {
    const receiptUrl =
      typeof settlement.receiptUrl === "string"
        ? settlement.receiptUrl.trim()
        : "";

    if (
      receiptUrl &&
      /^https?:\/\//i.test(receiptUrl)
    ) {
      window.open(
        receiptUrl,
        "_blank",
        "noopener,noreferrer"
      );
      return;
    }

    if (
      settlement.hasReceiptEvidence !== true
    ) {
      setError(
        "Settlement receipt evidence is not available."
      );
      return;
    }

    const merchantId =
      rowMerchantId(settlement) || selected;

    if (!merchantId) {
      setError(
        "Merchant information is not available for this settlement."
      );
      return;
    }

    const generation = session.current;

    const evidenceWindow =
      window.open("", "_blank");

    if (evidenceWindow) {
      evidenceWindow.opener = null;
    }

    try {
      setError("");

      const response =
        await platformFetch(
          `/merchants/${encodeURIComponent(
            merchantId
          )}/billing/settlements/${encodeURIComponent(
            settlement.id
          )}/evidence`,
          token
        );

      if (generation !== session.current) {
        evidenceWindow?.close();
        return;
      }

      if (!response.ok) {
        const data =
          await response
            .json()
            .catch(() => null);

        throw new PlatformApiError(
          data?.error ||
          `Failed to load settlement evidence (${response.status})`,
          response.status
        );
      }

      const blob =
        await response.blob();

      if (generation !== session.current) {
        evidenceWindow?.close();
        return;
      }

      const objectUrl =
        URL.createObjectURL(blob);

      if (evidenceWindow) {
        evidenceWindow.location.href =
          objectUrl;
      } else {
        const link =
          document.createElement("a");

        link.href = objectUrl;
        link.target = "_blank";
        link.rel =
          "noopener noreferrer";

        document.body.appendChild(
          link
        );

        link.click();
        link.remove();
      }

      window.setTimeout(
        () => {
          URL.revokeObjectURL(
            objectUrl
          );
        },
        60_000
      );
    } catch (e) {
      evidenceWindow?.close();

      if (generation === session.current) {
        fail(e);
      }
    }
  }
  useEffect(() => {
    // Refresh requests intentionally depend on revision.
    void revision;
    if (!token) return;
    const controller = new AbortController();
    const generation = session.current;

    setChecking(true);

    platformRequest<{ user: User }>(
      "/auth/me",
      token,
      "GET",
      undefined,
      controller.signal
    )
      .then(data => {
        if (
          controller.signal.aborted ||
          generation !== session.current
        ) {
          return;
        }

        setUser(data.user);
        setChecking(false);
      })
      .catch(e => {
        if (
          controller.signal.aborted ||
          generation !== session.current
        ) {
          return;
        }

        fail(e);
        setChecking(false);
      });
    return () => controller.abort();
  }, [token, revision, fail]);
  useEffect(() => {
    // Refresh requests intentionally depend on revision.
    void revision;
    if (!user || !token) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setRows([]); setOnboardingApplications([]); setMerchant(null); setRevenueSummary(null); setOverdueSummary(null);
    async function load() {
      const [m, p] = await Promise.all([
        platformRequest<{ merchants: Merchant[] }>("/merchants", token, "GET", undefined, controller.signal),
        platformRequest<{ plans: Plan[] }>("/plans", token, "GET", undefined, controller.signal)
      ]);
      let data: Row[] = []; let detail: Merchant | null = null;
      if (view === "Merchants" && selected) {
        const [d, history] = await Promise.all([
          platformRequest<{ merchant: Merchant }>(`/merchants/${encodeURIComponent(selected)}`, token, "GET", undefined, controller.signal),
          platformRequest<Record<string, Row[]>>(`/merchants/${encodeURIComponent(selected)}/billing/${ledger}`, token, "GET", undefined, controller.signal)
        ]);
        detail = d.merchant;
        data = history[ledger];
        } else if (view === "Merchant Onboarding") {
          const result = await platformRequest<{
            applications: MerchantOnboardingApplication[];
          }>(
            "/merchant-onboarding",
            token,
            "GET",
            undefined,
            controller.signal
          );

          if (!controller.signal.aborted) {
            setOnboardingApplications(result.applications);
          }
        } else if (view === "Invitation Deliveries") {
          const result = await platformRequest<{
            deliveries: Row[];
          }>(
            `/merchant-invitations/deliveries?status=${encodeURIComponent(
              invitationDeliveryStatus
            )}`,
            token,
            "GET",
            undefined,
            controller.signal
          );

          data = result.deliveries;
        } else if (view === "Billing Work") {
        const billingWorkRoutes: Record<
          BillingWorkTab,
          {
            path: string;
            key: "invoices" | "settlements";
          }
        > = {
          draft: {
            path: "/billing/invoices/draft",
            key: "invoices"
          },
          "awaiting-payment": {
            path: "/billing/invoices/awaiting-payment",
            key: "invoices"
          },
          review: {
            path: "/billing/settlements/review",
            key: "settlements"
          },
          resolved: {
            path: "/billing/settlements/resolved",
            key: "settlements"
          }
        };

        const route =
          billingWorkRoutes[billingWorkTab];

        const [result, summary] =
          await Promise.all([
            platformRequest<
              Record<string, Row[]>
            >(
              route.path,
              token,
              "GET",
              undefined,
              controller.signal
            ),
            platformRequest<BillingWorkSummary>(
              "/billing/work/summary",
              token,
              "GET",
              undefined,
              controller.signal
            )
          ]);

        data = result[route.key];

        if (!controller.signal.aborted) {
          setBillingWorkSummary(summary);
        }
      } else if (view === "Revenue") {
        let range: {
          start: string;
          end: string;
        } | null = null;

        if (revenuePeriodMode === "month") {
          range =
            revenueMonthRange(
              revenueMonth
            );
        } else if (
          revenuePeriodMode === "year"
        ) {
          range =
            revenueYearRange(
              revenueYear
            );
        } else if (
          revenueCustomStart &&
          revenueCustomEnd
        ) {
          range = {
            start: revenueCustomStart,
            end:
              nextUtcDate(
                revenueCustomEnd
              )
          };
        }

        const revenue =
          await platformRequest<{
            invoices: Row[];
          }>(
            "/billing/revenue",
            token,
            "GET",
            undefined,
            controller.signal
          );

        data = revenue.invoices;

        if (range) {
          const [summary, rangeRevenue] =
            await Promise.all([
              platformRequest<RevenuePeriodSummary>(
                `/billing/revenue/range-summary?start=${encodeURIComponent(
                  range.start
                )}&end=${encodeURIComponent(
                  range.end
                )}`,
                token,
                "GET",
                undefined,
                controller.signal
              ),
              platformRequest<{
                invoices: Row[];
              }>(
                `/billing/revenue/range?start=${encodeURIComponent(
                  range.start
                )}&end=${encodeURIComponent(
                  range.end
                )}`,
                token,
                "GET",
                undefined,
                controller.signal
              )
            ]);

          data = rangeRevenue.invoices;

          if (!controller.signal.aborted) {
            setRevenueSummary(summary);
          }
        }
      } else if (view === "Overdue") {
        let range: {
          start: string;
          end: string;
        } | null = null;

        if (overduePeriodMode === "month") {
          range =
            revenueMonthRange(
              overdueMonth
            );
        } else if (
          overduePeriodMode === "year"
        ) {
          range =
            revenueYearRange(
              overdueYear
            );
        } else if (
          overdueCustomStart &&
          overdueCustomEnd
        ) {
          range = {
            start: overdueCustomStart,
            end:
              nextUtcDate(
                overdueCustomEnd
              )
          };
        }

        if (range) {
          const [summary, overdue] =
            await Promise.all([
              platformRequest<OverduePeriodSummary>(
                `/billing/overdue/range-summary?start=${encodeURIComponent(
                  range.start
                )}&end=${encodeURIComponent(
                  range.end
                )}`,
                token,
                "GET",
                undefined,
                controller.signal
              ),
              platformRequest<{
                invoices: Row[];
              }>(
                `/billing/overdue/range?start=${encodeURIComponent(
                  range.start
                )}&end=${encodeURIComponent(
                  range.end
                )}`,
                token,
                "GET",
                undefined,
                controller.signal
              )
            ]);

          data = overdue.invoices;

          if (!controller.signal.aborted) {
            setOverdueSummary(summary);
          }
        }
      } else if (
        view === "Operators" &&
        user?.role === "OWNER"
      ) {
        const result =
          await platformRequest<{
            users: Row[];
          }>(
            "/users",
            token,
            "GET",
            undefined,
            controller.signal
          );

        data = result.users;
      } else if (view === "Audit") {
        const result =
          await platformRequest<{
            auditLogs: Row[];
          }>(
            "/audit",
            token,
            "GET",
            undefined,
            controller.signal
          );

        data = result.auditLogs;
      }
      if (!controller.signal.aborted) { setMerchants(m.merchants); setPlans(p.plans); setMerchant(detail); setRows(data); setLoading(false); }
    }
    load().catch(e => { if (!controller.signal.aborted) { fail(e); setLoading(false); } });
    return () => controller.abort();
  }, [
    user,
    token,
    view,
    selected,
    ledger,
    invitationDeliveryStatus,
    billingWorkTab,
    revenuePeriodMode,
    revenueMonth,
    revenueYear,
    revenueCustomStart,
    revenueCustomEnd,
    overduePeriodMode,
    overdueMonth,
    overdueYear,
    overdueCustomStart,
    overdueCustomEnd,
    revision,
    fail
  ]);
  const loginInFlight = useRef(false);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loginInFlight.current) {
      return;
    }

    loginInFlight.current = true;

    const data = new FormData(event.currentTarget);

    setBusy(true);
    setError("");

    try {
      const result = await platformRequest<{ token: string }>(
        "/auth/login",
        "",
        "POST",
        {
          email: data.get("email"),
          password: data.get("password")
        }
      );

      try {
        sessionStorage.setItem(PLATFORM_SESSION_KEY, result.token);
      } catch {
        /* Allow an in-memory session when storage is unavailable. */
      }

      session.current++;
      setToken(result.token);
    } catch (e) {
      fail(e);
    } finally {
      loginInFlight.current = false;
      setBusy(false);
    }
  }
  async function changePassword(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();

    const data =
      new FormData(
        event.currentTarget
      );

    const generation = session.current;

    setBusy(true);
    setError("");

    try {
      await platformRequest(
        "/auth/password",
        token,
        "PATCH",
        {
          currentPassword:
            data.get(
              "currentPassword"
            ),
          newPassword:
            data.get(
              "newPassword"
            )
        }
      );

      if (generation === session.current) {
        logout();
      }
    } catch (e) {
      if (generation === session.current) {
        fail(e);
      }
    } finally {
      if (generation === session.current) {
        setBusy(false);
      }
    }
  }
  async function submit(body: unknown) {
    if (!action || busy) return;
    const generation = session.current; setBusy(true); setError(""); setNotice("");
    try {
      await platformRequest(action.path, token, action.method, body);
      if (generation === session.current) { setAction(null); setNotice("Operation completed. Records refreshed from the server."); setRevision(v => v + 1); }
    } catch (e) { if (generation === session.current) fail(e); throw e; }
    finally { if (generation === session.current) setBusy(false); }
  }
  function planAction(plan?: Plan) {
    const fields = [...(plan ? [] : [field("code", "Plan code")]), field("name", "Name"), field("monthlyPrice", "Monthly price", "number"), field("annualPrice", "Annual price", "number"), field("currency", "Currency (3-letter code)"), field("commissionRate", "Commission rate (decimal, e.g. 0.05 = 5%)", "number"), field("features", "Features (JSON)", "json", true)].map(f => ({ ...f, value: plan?.[f.name] }));
    setAction({ title: plan ? `Edit ${plan.name}` : "Create plan", path: plan ? `/plans/${encodeURIComponent(plan.id)}` : "/plans", method: plan ? "PATCH" : "POST", fields, note: "Existing subscription price and commission snapshots remain governed by the backend." });
  }
  function merchantAction() {
    setAction({
      title: "Submit merchant onboarding application",
      path: "/merchant-onboarding",
      method: "POST",
      fields: [
        field("name", "Merchant name"),
        field("phone", "Primary phone"),
        field("alternatePhone", "Alternate phone", "text", true),
        field("address", "Address", "text", true),
        field("telegramUsername", "Telegram username", "text", true),
        field("ownerEmail", "Owner email", "email"),
        field("ownerDisplayName", "Owner display name", "text", true)
      ],
      note:
        "Submitting an application does not create a merchant account. " +
        "A different authorized platform administrator must approve it. " +
        "The merchant owner will set their own password through a secure invitation."
    });
  }
  function editOnboardingAction(
    application: MerchantOnboardingApplication
  ) {
    if (application.status !== "PENDING_APPROVAL") {
      return;
    }

    setAction({
      title: `Edit application — ${application.name}`,
      path: `/merchant-onboarding/${encodeURIComponent(application.id)}`,
      method: "PATCH",
      fields: [
        field("name", "Merchant name"),
        field("phone", "Primary phone"),
        field("alternatePhone", "Alternate phone", "text", true),
        field("address", "Address", "text", true),
        field("telegramUsername", "Telegram username", "text", true),
        field("ownerEmail", "Owner email", "email"),
        field("ownerDisplayName", "Owner display name", "text", true)
      ].map(f => ({
        ...f,
        value: application[f.name]
      })),
      note:
        "Corrections are permitted only while the application is pending. " +
        "Changes are validated and audited by the server.",
      transform: values => ({
        ...values,
        alternatePhone: values.alternatePhone ?? "",
        address: values.address ?? "",
        telegramUsername: values.telegramUsername ?? "",
        ownerDisplayName: values.ownerDisplayName ?? ""
      })
    });
  }
  function approveOnboardingAction(
    application: MerchantOnboardingApplication
  ) {
    if (
      !user ||
      user.role === "STAFF" ||
      application.status !== "PENDING_APPROVAL" ||
      application.createdById === user.id
    ) {
      return;
    }

    setAction({
      title: `Approve application — ${application.name}`,
      path: `/merchant-onboarding/${encodeURIComponent(application.id)}/approve`,
      method: "POST",
      fields: [],
      note:
        "Approval creates the merchant account and prepares a secure " +
        "owner activation invitation. The merchant owner must set " +
        "their own password. Confirm that the application details " +
        "have been independently reviewed."
    });
  }
  function rejectOnboardingAction(
    application: MerchantOnboardingApplication
  ) {
    if (
      !user ||
      user.role === "STAFF" ||
      application.status !== "PENDING_APPROVAL" ||
      application.createdById === user.id
    ) {
      return;
    }

    setAction({
      title: `Reject application — ${application.name}`,
      path: `/merchant-onboarding/${encodeURIComponent(application.id)}/reject`,
      method: "POST",
      fields: [
        field("reason", "Rejection reason")
      ],
      note:
        "Rejection prevents this application from creating a merchant account. " +
        "A reason is required and the decision is recorded in the platform audit log."
    });
  }
  function discardOnboardingAction(
    application: MerchantOnboardingApplication
  ) {
    if (
      !user ||
      user.role === "STAFF" ||
      application.status !== "PENDING_APPROVAL" ||
      application.createdById === user.id
    ) {
      return;
    }

    setAction({
      title: `Discard application — ${application.name}`,
      path: `/merchant-onboarding/${encodeURIComponent(application.id)}/discard`,
      method: "POST",
      fields: [
        field("reason", "Discard reason")
      ],
      note:
        "Discarding closes this pending application without creating " +
        "a merchant account. A reason is required, and the decision " +
        "is recorded in the platform audit log."
    });
  }
  const merchantPath = `/merchants/${encodeURIComponent(selected)}`;
  if (!user) return <main className="pa-root"><section className="pa-login pa-card"><p className="pa-eyebrow">ETHIO COMMERCE / PLATFORM</p><h1>Platform administration</h1><p>Sign in with your platform operator account.</p>{error && <p role="alert" className="pa-error">{error}</p>}{checking ? <p role="status">Validating platform session…</p> : <form onSubmit={login}><fieldset disabled={busy}><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>Password<input name="password" type="password" autoComplete="current-password" required /></label><button type="submit">{busy ? "Signing in…" : "Sign in"}</button></fieldset></form>}{token && !checking && <button type="button" onClick={logout}>Clear session and sign in again</button>}<p><a href="/">Merchant dashboard</a></p></section></main>;
  return <div className="pa-root"><header className="pa-header"><div><p className="pa-eyebrow">ETHIO COMMERCE</p><h1>Platform administration</h1></div><div>{user.displayName || user.email}<div className="pa-buttons">
    <button
      type="button"
      onClick={() =>
        setChangingPassword(true)
      }
    >
      Change password
    </button>

    <a href="/">
      Merchant dashboard
    </a>

    <button
      type="button"
      onClick={logout}
    >
      Sign out
    </button>
  </div></div></header>

    {changingPassword && (
      <div className="pa-modal-backdrop">
        <ModalBackdrop
          close={() => setChangingPassword(false)}
          label="Close password dialog backdrop"
        />
        <section
          className="pa-modal pa-action-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Change password"
        >
          <div className="pa-modal-head">
            <div>
              <p className="pa-eyebrow">
                PLATFORM ACCOUNT
              </p>

              <h2>
                Change password
              </h2>
            </div>

            <button
              type="button"
              className="pa-icon-button"
              onClick={() =>
                setChangingPassword(false)
              }
              aria-label="Close"
            >
              ×
            </button>
          </div>

          <p>
            Enter your current password and choose
            a new password with at least 8 characters.
            Changing it will sign out existing platform
            sessions.
          </p>

          <form onSubmit={changePassword}>
            <fieldset disabled={busy}>
              <label>
                Current password
                <input
                  name="currentPassword"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>

              <label>
                New password
                <input
                  name="newPassword"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </label>

              <div className="pa-buttons">
                <button type="submit">
                  {busy
                    ? "Changing password…"
                    : "Change password"}
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setChangingPassword(false)
                  }
                >
                  Cancel
                </button>
              </div>
            </fieldset>
          </form>
        </section>
      </div>
    )}

<nav aria-label="Platform sections">
  {([
    "Merchants",
    "Merchant Onboarding",
    "Invitation Deliveries",
    "Billing Work",
        ...(user.role === "OWNER" ? ["Operators" as View] : []),
        ...(user.role !== "STAFF"
          ? ["Revenue" as View, "Overdue" as View]
          : []),
        "Plans",
        ...(user.role !== "STAFF" ? ["Audit" as View] : [])
      ] as View[]).map(v => (
        <button
          type="button"
          key={v}
          aria-current={view === v ? "page" : undefined}
          disabled={busy}
          onClick={() => {
            setView(v);
            setSelected("");
            setAction(null);
            setSearch("");
          }}
        >
          {v}
        </button>
      ))}
    </nav>
    <main>
      {view === "Merchants" && selected ? <div className="pa-detail-header"><button type="button" className="pa-back-button" onClick={() => { setSelected(""); setAction(null); setRows([]); }}>← Back to merchants</button><button type="button" disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>Refresh</button></div> : <div className="pa-title"><div><h2>{view}</h2><p>{view === "Revenue" ? "Paid invoices, as recorded by the server. Amounts retain their original currency." : view === "Overdue" ? "Invoices marked OVERDUE by the server." : view === "Audit" ? "Latest 100 platform audit entries." : "Manage platform accounts and billing."}</p></div><button type="button" disabled={busy || loading} onClick={() => setRevision(v => v + 1)}>Refresh</button></div>}
      {error && <p role="alert" className="pa-error">{error}</p>}{notice && <p role="status" className="pa-success">{notice}</p>}{action && <ActionForm key={action.title + action.path} action={action} busy={busy} submit={submit} close={() => setAction(null)} />}
      {loading ? <p role="status">Loading records…</p> : error ? <p>Use Refresh to retry loading current records.</p> : <>
        {view === "Merchants" && !selected && <>
          <div className="pa-merchant-toolbar">
            <label className="pa-search">Find a merchant<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, ID, phone, address, status or plan" /></label>
            <label>Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option value="ALL">All statuses</option><option value="NO_SUBSCRIPTION">No subscription</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select></label>
            <label>Plan<select value={planFilter} onChange={e => setPlanFilter(e.target.value)}><option value="ALL">All plans</option>{plans.map(plan => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></label>
            <label>Billing<select value={billingFilter} onChange={e => setBillingFilter(e.target.value)}><option value="ALL">All intervals</option><option value="MONTHLY">MONTHLY</option><option value="ANNUAL">ANNUAL</option><option value="NONE">No subscription</option></select></label>
            <label>Opened<select value={createdFilter} onChange={e => setCreatedFilter(e.target.value)}><option value="ALL">Any time</option><option value="TODAY">Today</option><option value="7D">Last 7 days</option><option value="30D">Last 30 days</option></select></label>
          </div>
          <div className="pa-filter-summary"><span>{merchants.filter(m => {
            const textMatch = `${m.name} ${m.id} ${m.phone || ""} ${m.alternatePhone || ""} ${m.address || ""} ${m.subscription?.status || ""} ${m.subscription?.plan?.name || ""}`.toLowerCase().includes(search.toLowerCase());
            const statusMatch = statusFilter === "ALL" || (statusFilter === "NO_SUBSCRIPTION" ? !m.subscription : m.subscription?.status === statusFilter);
            const planMatch = planFilter === "ALL" || m.subscription?.plan?.id === planFilter;
            const billingMatch = billingFilter === "ALL" || (billingFilter === "NONE" ? !m.subscription : m.subscription?.billingInterval === billingFilter);
            let createdMatch = true;
            if (createdFilter !== "ALL") {
              if (!m.createdAt) createdMatch = false;
              else {
                const created = new Date(m.createdAt).getTime();
                const now = Date.now();
                const day = 24 * 60 * 60 * 1000;
                createdMatch = createdFilter === "TODAY" ? new Date(m.createdAt).toDateString() === new Date().toDateString() : created >= now - (createdFilter === "7D" ? 7 : 30) * day;
              }
            }
            return textMatch && statusMatch && planMatch && billingMatch && createdMatch;
          }).length} of {merchants.length} merchants</span><button type="button" className="pa-link-button" onClick={() => { setSearch(""); setStatusFilter("ALL"); setPlanFilter("ALL"); setBillingFilter("ALL"); setCreatedFilter("ALL"); }}>Clear filters</button></div>
          <div className="pa-table"><table><thead><tr><th>Merchant</th><th>Subscription</th><th>Plan</th><th>Billing</th><th>Current period</th><th>Opened</th><th>Currency</th><th>Action</th></tr></thead><tbody>{merchants.filter(m => {
            const textMatch = `${m.name} ${m.id} ${m.phone || ""} ${m.alternatePhone || ""} ${m.address || ""} ${m.subscription?.status || ""} ${m.subscription?.plan?.name || ""}`.toLowerCase().includes(search.toLowerCase());
            const statusMatch = statusFilter === "ALL" || (statusFilter === "NO_SUBSCRIPTION" ? !m.subscription : m.subscription?.status === statusFilter);
            const planMatch = planFilter === "ALL" || m.subscription?.plan?.id === planFilter;
            const billingMatch = billingFilter === "ALL" || (billingFilter === "NONE" ? !m.subscription : m.subscription?.billingInterval === billingFilter);
            let createdMatch = true;
            if (createdFilter !== "ALL") {
              if (!m.createdAt) createdMatch = false;
              else {
                const created = new Date(m.createdAt).getTime();
                const now = Date.now();
                const day = 24 * 60 * 60 * 1000;
                createdMatch = createdFilter === "TODAY" ? new Date(m.createdAt).toDateString() === new Date().toDateString() : created >= now - (createdFilter === "7D" ? 7 : 30) * day;
              }
            }
            return textMatch && statusMatch && planMatch && billingMatch && createdMatch;
          }).map(m => <tr key={m.id}><td><strong>{m.name}</strong><span className="pa-subtle pa-code">{m.id}</span></td><td><span className={`pa-status pa-status-${String(m.subscription?.status || "none").toLowerCase().replace(/_/g, "-")}`}>{m.subscription?.status || "No subscription"}</span></td><td>{m.subscription?.plan?.name || "—"}<span className="pa-subtle">{m.subscription?.plan?.code || ""}</span></td><td>{display(m.subscription?.billingInterval)}<span className="pa-subtle">{display(m.subscription?.priceSnapshot)} {m.subscription?.currency || m.currency || ""}</span></td><td>{m.subscription?.currentPeriodStart ? new Date(String(m.subscription.currentPeriodStart)).toLocaleDateString() : "—"}<span className="pa-subtle">to {m.subscription?.currentPeriodEnd ? new Date(String(m.subscription.currentPeriodEnd)).toLocaleDateString() : "—"}</span></td><td>{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : "—"}</td><td>{m.currency || m.subscription?.currency || "—"}</td><td><button type="button" disabled={busy} onClick={() => { setSelected(m.id); setLedger("invoices"); setAction(null); }}>Manage</button></td></tr>)}</tbody></table></div></>}
        {view === "Merchant Onboarding" && (
  <section className="pa-card">
  <div className="pa-buttons">
  <button
    type="button"
    disabled={busy}
    onClick={merchantAction}
  >
    Submit onboarding application
  </button>
</div>
    <div className="pa-section-heading">
      <div>
        <h3>Merchant onboarding applications</h3>
        <p>
          Review submitted applications and track their
          approval status.
        </p>
      </div>
    </div>

    <Table
  rows={onboardingApplications}
  columns={[
    "name",
    "status",
    "phone",
    "ownerEmail",
    "currency",
    "createdAt"
  ]}
  actions={row => {
    const application =
      row as MerchantOnboardingApplication;

    if (application.status !== "PENDING_APPROVAL") {
      return null;
    }

    const canApprove =
      user.role !== "STAFF" &&
      application.createdById !== user.id;

    return (
      <>
        <button
          type="button"
          disabled={busy}
          onClick={() => editOnboardingAction(application)}
        >
          Edit
        </button>

        {canApprove && (
  <>
    <button
      type="button"
      disabled={busy}
      onClick={() => approveOnboardingAction(application)}
    >
      Approve
    </button>

    <button
      type="button"
      disabled={busy}
      onClick={() => rejectOnboardingAction(application)}
    >
      Reject
    </button>
    <button
      type="button"
      disabled={busy}
      onClick={() => discardOnboardingAction(application)}
    >
      Discard
    </button>
  </>
)}
      </>
    );
  }}
/>
  </section>
)}{view === "Invitation Deliveries" && (
  <section className="pa-card">
    <div className="pa-section-heading">
      <div>
        <h3>Merchant Invitation Deliveries</h3>
        <p>
          Inspect invitation email delivery records.
          Provider acceptance does not confirm recipient delivery.
        </p>
      </div>
    </div>

    <div className="pa-buttons">
      <label>
        Delivery status
        <select
          value={invitationDeliveryStatus}
          onChange={event =>
            setInvitationDeliveryStatus(event.target.value)
          }
        >
          {[
            "REVIEW_REQUIRED",
            "PENDING",
            "PROCESSING",
            "SENDING",
            "SENT",
            "FAILED"
          ].map(status => (
            <option key={status} value={status}>
              {status.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </label>
    </div>

    <p className="pa-subtle">
      Showing up to 50 matching records, oldest updated first.
      This view is read-only.
    </p>
    <Table
      rows={rows.map(row => {
        const activation = row.activation;

        const merchant =
          activation &&
          typeof activation === "object" &&
          "merchant" in activation
            ? activation.merchant
            : null;

        const merchantName =
          merchant &&
          typeof merchant === "object" &&
          "name" in merchant &&
          typeof merchant.name === "string"
            ? merchant.name
            : "—";

        return {
          ...row,
          merchantName
        };
      })}
      columns={[
        "merchantName",
        "recipientEmail",
        "status",
        "attemptCount",
        "lastError",
        "updatedAt",
        "nextAttemptAt"
      ]}
    />
  </section>
)}{view === "Merchants" && selected && merchant && <section className="pa-merchant-detail"><div className="pa-merchant-hero"><div><p className="pa-eyebrow">MERCHANT ACCOUNT</p><h2>{merchant.name}</h2><p className="pa-code">{merchant.id}</p></div><span className={`pa-status pa-status-${String(merchant.subscription?.status || "none").toLowerCase().replace(/_/g, "-")}`}>{merchant.subscription?.status || "No subscription"}</span></div><section className="pa-card"><div className="pa-section-heading"><div><h3>Subscription</h3><p>Current server-authoritative subscription snapshot.</p></div>{user.role !== "STAFF" &&
          merchant.subscription &&
          !!transitions[merchant.subscription.status]?.length && <button type="button" disabled={busy} onClick={() => setAction({ title: `Change subscription status — ${merchant.name}`, path: `${merchantPath}/subscription/status`, method: "PATCH", fields: [{ name: "nextStatus", label: "Next status", options: merchant.subscription ? transitions[merchant.subscription.status] : [] }] })}>Change status</button>}</div>{merchant.subscription ? <div className="pa-metric-grid"><div><span>Status</span><strong>{merchant.subscription.status}</strong></div><div><span>Plan</span><strong>{merchant.subscription.plan.name}</strong><small>{merchant.subscription.plan.code}</small></div><div><span>Billing interval</span><strong>{display(merchant.subscription.billingInterval)}</strong></div><div><span>Price snapshot</span><strong>{display(merchant.subscription.priceSnapshot)} {merchant.subscription.currency || ""}</strong></div><div><span>Commission rate</span><strong>{merchant.subscription.commissionRateSnapshot == null ? "—" : `${Number(merchant.subscription.commissionRateSnapshot) * 100}%`}</strong></div><div><span>Currency</span><strong>{merchant.subscription.currency || merchant.currency || "—"}</strong></div><div><span>Period start</span><strong>{merchant.subscription.currentPeriodStart ? new Date(String(merchant.subscription.currentPeriodStart)).toLocaleDateString() : "—"}</strong></div><div><span>Period end</span><strong>{merchant.subscription.currentPeriodEnd ? new Date(String(merchant.subscription.currentPeriodEnd)).toLocaleDateString() : "—"}</strong></div></div> : <><p>No subscription.</p>{user.role !== "STAFF" && (<button type="button" disabled={busy || !plans.some(p => p.isActive)} onClick={() => setAction({ title: `Initialize subscription — ${merchant.name}`, path: `${merchantPath}/subscription`, method: "POST", fields: [{ name: "planId", label: "Plan ID", options: plans.filter(p => p.isActive).map(p => p.id) }, { name: "billingInterval", label: "Billing interval", options: ["MONTHLY", "ANNUAL"] }, { name: "status", label: "Initial status", options: statuses }, ...dateFields("currentPeriodStart", "currentPeriodEnd"), field("trialEndsAt", "Trial end (local time)", "datetime-local", true)] })}>Initialize subscription</button>)}</>}</section>

          <section className="pa-card">
            <div className="pa-section-heading">
              <div>
                <h3>Account status</h3>
                <p>
                  Platform account enforcement, separate from billing subscription status.
                </p>
              </div>

              {user.role !== "STAFF" &&
                merchant.accountStatus === "ACTIVE" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setAction({
                        title: `Suspend account — ${merchant.name}`,
                        path: `${merchantPath}/account/status`,
                        method: "PATCH",
                        fields: [
                          { name: "reason", label: "Reason" }
                        ],
                        transform: values => ({
                          ...values,
                          nextStatus: "SUSPENDED"
                        })
                      })
                    }
                  >
                    Suspend account
                  </button>
                )}

              {user.role !== "STAFF" &&
                merchant.accountStatus === "SUSPENDED" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setAction({
                        title: `Reinstate account — ${merchant.name}`,
                        path: `${merchantPath}/account/status`,
                        method: "PATCH",
                        fields: [
                          { name: "reason", label: "Reason" }
                        ],
                        transform: values => ({
                          ...values,
                          nextStatus: "ACTIVE"
                        })
                      })
                    }
                  >
                    Reinstate account
                  </button>
                )}
            </div>

            <div className="pa-metric-grid">
              <div>
                <span>Status</span>
                <strong>{merchant.accountStatus}</strong>
              </div>

              {merchant.accountStatus === "SUSPENDED" && (
                <>
                  <div>
                    <span>Suspension reason</span>
                    <strong>
                      {merchant.accountSuspensionReason || "—"}
                    </strong>
                  </div>
                  <div>
                    <span>Suspended at</span>
                    <strong>
                      {merchant.accountSuspendedAt
                        ? new Date(
                          merchant.accountSuspendedAt
                        ).toLocaleString()
                        : "—"}
                    </strong>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="pa-card">  <div className="pa-section-heading">    <div>      <h3>Merchant Contact</h3>      <p>Business contact information maintained by the merchant.</p>    </div>  </div>  <div className="pa-metric-grid">    <div><span>Phone</span><strong>{merchant.phone || "-"}</strong></div>    <div><span>Alternate phone</span><strong>{merchant.alternatePhone || "-"}</strong></div>    <div><span>Address</span><strong>{merchant.address || "-"}</strong></div>  </div></section><section className="pa-card"><div className="pa-section-heading"><div><h3>Billing</h3><p>Invoices, commissions and settlement evidence.</p></div>{ledger === "invoices" && <button type="button" disabled={busy} onClick={() => setAction({ title: `Generate draft invoice — ${merchant.name}`, path: `${merchantPath}/billing/invoices`, method: "POST", note: "Enter the invoice period explicitly. To include a subscription charge, supply all three optional subscription fields. Totals are calculated and persisted by the server.", fields: [field("invoiceNumber", "Invoice number"), ...dateFields("periodStart", "periodEnd"), field("dueAt", "Due date (local time)", "datetime-local", true), field("subscriptionId", "Subscription ID", "text", true), ...dateFields("billingPeriodStart", "billingPeriodEnd").map(f => ({ ...f, optional: true }))], transform: values => { const { subscriptionId, billingPeriodStart, billingPeriodEnd, ...rest } = values; if (subscriptionId || billingPeriodStart || billingPeriodEnd) { if (!subscriptionId || !billingPeriodStart || !billingPeriodEnd) throw new Error("Supply subscription ID and both subscription billing dates."); return { ...rest, subscriptionCharge: { subscriptionId, billingPeriodStart, billingPeriodEnd } }; } return rest; } })}>Generate draft invoice</button>}</div><div className="pa-tabs">{["invoices", "commissions", "settlements"].map(v => <button type="button" key={v} disabled={busy} aria-pressed={ledger === v} onClick={() => { setLedger(v); setAction(null); }}>{label(v)}</button>)}</div><Table rows={rows} columns={ledger === "invoices" ? ["invoiceNumber", "status", "totalAmount", "currency", "dueAt"] : ledger === "commissions" ? ["orderId", "commissionAmount", "adjustmentAmount", "netCommissionAmount", "currency", "status"] : ["invoiceId", "amount", "currency", "status", "transactionReference"]} actions={r => <>{ledger === "invoices" && r.status === "DRAFT" && <button type="button" disabled={busy} onClick={() => setAction({ title: `Open invoice ${r.invoiceNumber}`, path: `${merchantPath}/billing/invoices/${encodeURIComponent(r.id)}/open`, method: "POST", fields: [], note: `Open persisted invoice for ${r.totalAmount} ${r.currency}?` })}>Open invoice</button>}{ledger === "settlements" && <>{(
            r.hasReceiptEvidence === true ||
            (
              typeof r.receiptUrl === "string" &&
              /^https?:\/\//i.test(
                r.receiptUrl
              )
            )
          ) && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void openSettlementEvidence(
                    r
                  )
                }
              >
                View receipt
              </button>
            )}{r.status === "REVIEW_REQUIRED" && ["verify", "reject"].map(v => <button type="button" key={v} disabled={busy} onClick={() => setAction({ title: `${label(v)} settlement ${r.id}`, path: `${merchantPath}/billing/settlements/${encodeURIComponent(r.id)}/${v}`, method: "POST", fields: [field("reviewNote", "Review note", "text", true)], note: `${label(v)} evidence for ${r.amount} ${r.currency}, invoice ${r.invoiceId}. Verification can mark the associated OPEN invoice paid; the server enforces eligibility.` })}>{label(v)}</button>)}</>}</>} /></section></section>}
        {view === "Billing Work" && (
          <>
            <section className="pa-card">
              <div className="pa-section-heading">
                <div>
                  <h3>Today's Billing Work</h3>
                  <p>
                    Current pending workload and settlement
                    decisions completed today (UTC).
                  </p>
                </div>
              </div>

              {billingWorkSummary && (
                <div className="pa-metric-grid">
                  <div>
                    <span>Pending total</span>
                    <strong>
                      {billingWorkSummary.pending.total}
                    </strong>
                    <small>
                      Draft invoices:{" "}
                      {billingWorkSummary.pending.draftInvoices}
                    </small>
                    <small>
                      Awaiting payment:{" "}
                      {billingWorkSummary.pending.awaitingPayment}
                    </small>
                    <small>
                      Payment review:{" "}
                      {billingWorkSummary.pending.paymentReview}
                    </small>
                  </div>

                  <div>
                    <span>Resolved today</span>
                    <strong>
                      {billingWorkSummary.resolvedToday.total}
                    </strong>
                    <small>
                      Verified:{" "}
                      {billingWorkSummary.resolvedToday.verified}
                    </small>
                    <small>
                      Rejected:{" "}
                      {billingWorkSummary.resolvedToday.rejected}
                    </small>
                  </div>
                </div>
              )}
            </section>

            <div className="pa-tabs">
              {(
                [
                  ["draft", "Draft Invoices"],
                  [
                    "awaiting-payment",
                    "Awaiting Payment"
                  ],
                  ["review", "Payment Review"],
                  ["resolved", "Resolved"]
                ] as [
                  BillingWorkTab,
                  string
                ][]
              ).map(([tab, text]) => (
                <button
                  key={tab}
                  type="button"
                  disabled={busy}
                  aria-pressed={
                    billingWorkTab === tab
                  }
                  onClick={() => {
                    setBillingWorkTab(tab);
                    setAction(null);
                  }}
                >
                  {text}
                </button>
              ))}
            </div>

            {(billingWorkTab === "draft" ||
              billingWorkTab ===
              "awaiting-payment") && (
                <Table
                  rows={billingWorkRows(rows)}
                  columns={[
                    "invoiceNumber",
                    "merchantName",
                    "totalAmount",
                    "currency",
                    "status",
                    billingWorkTab === "draft"
                      ? "createdAt"
                      : "openedAt"
                  ]}
                  actions={r => {
                    const merchantId =
                      rowMerchantId(r);

                    if (
                      billingWorkTab !== "draft" ||
                      r.status !== "DRAFT" ||
                      !merchantId
                    ) {
                      return null;
                    }

                    return (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setAction({
                            title:
                              `Open invoice ${r.invoiceNumber}`,
                            path:
                              `/merchants/${encodeURIComponent(
                                merchantId
                              )}/billing/invoices/${encodeURIComponent(
                                r.id
                              )}/open`,
                            method: "POST",
                            fields: [],
                            note:
                              `Open invoice ${r.invoiceNumber} for ${r.totalAmount} ${r.currency}. The server enforces invoice lifecycle eligibility.`
                          })
                        }
                      >
                        Open invoice
                      </button>
                    );
                  }}
                />
              )}

            {(billingWorkTab === "review" ||
              billingWorkTab === "resolved") && (
                <Table
                  rows={billingWorkRows(rows)}
                  columns={[
                    "merchantName",
                    "invoiceNumber",
                    "amount",
                    "currency",
                    "status",
                    "provider",
                    "transactionReference",
                    billingWorkTab === "review"
                      ? "submittedAt"
                      : "verifiedAt"
                  ]}
                  actions={r => {
                    const merchantId =
                      rowMerchantId(r);

                    const hasReceipt =
                      r.hasReceiptEvidence === true ||
                      (
                        typeof r.receiptUrl ===
                        "string" &&
                        /^https?:\/\//i.test(
                          r.receiptUrl
                        )
                      );

                    return (
                      <>
                        {hasReceipt && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void openSettlementEvidence(
                                r
                              )
                            }
                          >
                            View receipt
                          </button>
                        )}

                        {billingWorkTab === "review" &&
                          r.status ===
                          "REVIEW_REQUIRED" &&
                          merchantId &&
                          ["verify", "reject"].map(
                            operation => (
                              <button
                                key={operation}
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setAction({
                                    title:
                                      `${label(
                                        operation
                                      )} settlement ${r.id}`,
                                    path:
                                      `/merchants/${encodeURIComponent(
                                        merchantId
                                      )}/billing/settlements/${encodeURIComponent(
                                        r.id
                                      )}/${operation}`,
                                    method: "POST",
                                    fields: [
                                      field(
                                        "reviewNote",
                                        "Review note",
                                        "text",
                                        true
                                      )
                                    ],
                                    note:
                                      `${label(
                                        operation
                                      )} evidence for ${r.amount} ${r.currency}, invoice ${r.invoiceId}. Verification can mark the associated OPEN invoice paid; the server enforces eligibility.`
                                  })
                                }
                              >
                                {label(operation)}
                              </button>
                            )
                          )}
                      </>
                    );
                  }}
                />
              )}
          </>
        )}{view === "Plans" && <>
          {user.role === "OWNER" && (
            <button type="button" disabled={busy} onClick={() => planAction()}>
              Create plan
            </button>
          )}<Table rows={plans} columns={["name", "code", "monthlyPrice", "annualPrice", "currency", "commissionRate", "isActive"]} actions={r => user.role === "OWNER" ? <><button type="button" disabled={busy} onClick={() => planAction(r as Plan)}>Edit</button><button type="button" disabled={busy} onClick={() => setAction({ title: `${r.isActive ? "Deactivate" : "Activate"} ${r.name}`, path: `/plans/${encodeURIComponent(r.id)}/active-state`, method: "PATCH", fields: [], transform: () => ({ isActive: !r.isActive }) })}>{r.isActive ? "Deactivate" : "Activate"}</button></> : null} /></>}
        {view === "Revenue" && (
          <>
            <section className="pa-card">
              <div className="pa-section-heading">
                <div>
                  <h3>Collected revenue</h3>
                  <p>
                    Review paid invoice revenue for a selected UTC period.
                    Amounts remain separated by currency.
                  </p>
                </div>
              </div>

              <div className="pa-tabs">
                <button
                  type="button"
                  className={
                    revenuePeriodMode === "month"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setRevenuePeriodMode("month")
                  }
                >
                  Month
                </button>

                <button
                  type="button"
                  className={
                    revenuePeriodMode === "year"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setRevenuePeriodMode("year")
                  }
                >
                  Year
                </button>

                <button
                  type="button"
                  className={
                    revenuePeriodMode === "custom"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setRevenuePeriodMode("custom")
                  }
                >
                  Custom range
                </button>
              </div>

              {revenuePeriodMode === "month" && (
                <label>
                  Month
                  <input
                    type="month"
                    value={revenueMonth}
                    onChange={event =>
                      setRevenueMonth(
                        event.target.value
                      )
                    }
                  />
                </label>
              )}

              {revenuePeriodMode === "year" && (
                <label>
                  Year
                  <input
                    type="number"
                    min="2000"
                    max="2100"
                    value={revenueYear}
                    onChange={event =>
                      setRevenueYear(
                        event.target.value
                      )
                    }
                  />
                </label>
              )}

              {revenuePeriodMode === "custom" && (
                <div className="pa-form-grid">
                  <label>
                    From
                    <input
                      type="date"
                      value={revenueCustomStart}
                      onChange={event =>
                        setRevenueCustomStart(
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    Through
                    <input
                      type="date"
                      value={revenueCustomEnd}
                      min={
                        revenueCustomStart ||
                        undefined
                      }
                      onChange={event =>
                        setRevenueCustomEnd(
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {revenueSummary &&
                revenueSummary.currencies.length > 0 ? (
                <div className="pa-metric-grid">
                  {revenueSummary.currencies.map(
                    summary => (
                      <div key={summary.currency}>
                        <span>{summary.currency}</span>
                        <strong>
                          Collected total:{" "}
                          {summary.totalAmount}{" "}
                          {summary.currency}
                        </strong>
                        <small>
                          Collected subscription:{" "}
                          {summary.subscriptionAmount}{" "}
                          {summary.currency}
                        </small>
                        <small>
                          Collected commission:{" "}
                          {summary.commissionAmount}{" "}
                          {summary.currency}
                        </small>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="pa-empty">
                  {revenuePeriodMode === "custom" &&
                    (!revenueCustomStart ||
                      !revenueCustomEnd)
                    ? "Choose both dates to view collected revenue."
                    : "No collected revenue for the selected period."}
                </p>
              )}
            </section>

            <Table
              rows={rows}
              columns={[
                "invoiceNumber",
                "merchant",
                "totalAmount",
                "currency",
                "status",
                "paidAt"
              ]}
            />
          </>
        )}

        {view === "Overdue" && (
          <>
            <section className="pa-card">
              <div className="pa-section-heading">
                <div>
                  <h3>Overdue invoices</h3>
                  <p>
                    Review invoices currently marked OVERDUE for a selected UTC period.
                    Amounts remain separated by currency.
                  </p>
                </div>
              </div>

              <div className="pa-tabs">
                <button
                  type="button"
                  className={
                    overduePeriodMode === "month"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setOverduePeriodMode("month")
                  }
                >
                  Month
                </button>

                <button
                  type="button"
                  className={
                    overduePeriodMode === "year"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setOverduePeriodMode("year")
                  }
                >
                  Year
                </button>

                <button
                  type="button"
                  className={
                    overduePeriodMode === "custom"
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setOverduePeriodMode("custom")
                  }
                >
                  Custom range
                </button>
              </div>

              {overduePeriodMode === "month" && (
                <label>
                  Month
                  <input
                    type="month"
                    value={overdueMonth}
                    onChange={event =>
                      setOverdueMonth(
                        event.target.value
                      )
                    }
                  />
                </label>
              )}

              {overduePeriodMode === "year" && (
                <label>
                  Year
                  <input
                    type="number"
                    min="2000"
                    max="2100"
                    value={overdueYear}
                    onChange={event =>
                      setOverdueYear(
                        event.target.value
                      )
                    }
                  />
                </label>
              )}

              {overduePeriodMode === "custom" && (
                <div className="pa-form-grid">
                  <label>
                    From
                    <input
                      type="date"
                      value={overdueCustomStart}
                      onChange={event =>
                        setOverdueCustomStart(
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    Through
                    <input
                      type="date"
                      value={overdueCustomEnd}
                      min={
                        overdueCustomStart ||
                        undefined
                      }
                      onChange={event =>
                        setOverdueCustomEnd(
                          event.target.value
                        )
                      }
                    />
                  </label>
                </div>
              )}

              {overdueSummary &&
                overdueSummary.currencies.length > 0 ? (
                <div className="pa-metric-grid">
                  {overdueSummary.currencies.map(
                    summary => (
                      <div key={summary.currency}>
                        <span>{summary.currency}</span>
                        <strong>
                          Overdue total:{" "}
                          {summary.totalAmount}{" "}
                          {summary.currency}
                        </strong>
                        <small>
                          Invoice count:{" "}
                          {summary.invoiceCount}
                        </small>
                      </div>
                    )
                  )}
                </div>
              ) : (
                <p className="pa-empty">
                  {overduePeriodMode === "custom" &&
                    (!overdueCustomStart ||
                      !overdueCustomEnd)
                    ? "Choose both dates to view overdue invoices."
                    : "No overdue invoices for the selected period."}
                </p>
              )}
            </section>

            <Table
              rows={rows}
              columns={[
                "invoiceNumber",
                "merchant",
                "totalAmount",
                "currency",
                "status",
                "dueAt"
              ]}
              actions={r => {
                const merchantId =
                  rowMerchantId(r);

                if (!merchantId) {
                  return null;
                }

                return (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setView("Merchants");
                      setSelected(merchantId);
                      setLedger("invoices");
                      setAction(null);
                    }}
                  >
                    Manage merchant
                  </button>
                );
              }}
            />
          </>
        )}
        {view === "Operators" && user.role === "OWNER" && (
          <>
            <div className="pa-buttons">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction({
                    title: "Create platform operator",
                    path: "/users",
                    method: "POST",
                    fields: [
                      field("email", "Email", "email"),
                      field("displayName", "Display name"),
                      field("password", "Password", "password"),
                      {
                        ...field("role", "Platform role"),
                        options: ["STAFF", "ADMIN"]
                      }
                    ],
                    note: "Only OWNER can create platform operators. OWNER accounts cannot be created here."
                  });
                }}
              >
                Create operator
              </button>
            </div>

            <Table
              rows={rows}
              columns={[
                "email",
                "displayName",
                "role",
                "createdAt"
              ]}
              actions={r => {
                if (r.role === "OWNER") {
                  return null;
                }

                return (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setAction({
                          title: `Change role: ${String(r.email)}`,
                          path: `/users/${encodeURIComponent(r.id)}`,
                          method: "PATCH",
                          fields: [
                            {
                              ...field("role", "Platform role"),
                              options: ["STAFF", "ADMIN"],
                              value: r.role
                            }
                          ],
                          note:
                            "Changing this operator's role will invalidate their existing sessions."
                        });
                      }}
                    >
                      Change role
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setAction({
                          title: `Reset password: ${String(r.email)}`,
                          path: `/users/${encodeURIComponent(r.id)}/password`,
                          method: "PATCH",
                          fields: [
                            field("newPassword", "New password (minimum 8 characters)", "password")
                          ],
                          note:
                            "Resetting this operator's password will invalidate their existing sessions. The new password must contain at least 8 characters."
                        });
                      }}
                    >
                      Reset password
                    </button>
                  </>
                );
              }}
            />
          </>
        )}

        {view === "Audit" && <Table rows={rows} columns={["createdAt", "actor", "action", "entityType", "entityId"]} />}
      </>}</main></div>;
}
