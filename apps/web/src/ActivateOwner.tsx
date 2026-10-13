
import { useEffect, useState, type FormEvent } from "react";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "http://localhost:3000";

export default function ActivateOwner() {
  const [token] = useState(
    () => new URLSearchParams(window.location.search).get("token") || ""
  );
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Remove the secret from the visible URL and browser history.
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!token) {
      setError("This activation link is invalid or missing its token.");
      return;
    }

    if (password.length < 8) {
      setError("Password must contain at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);

    try {
      const response = await fetch(
        `${API_BASE_URL}/auth/activate-owner`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, password })
        }
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error("Too many attempts. Please try again later.");
        }
        throw new Error(
          "Activation failed. The invitation may be expired or already used."
        );
      }

      setSuccess(true);
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Activation failed."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1>Yagebeya</h1>
        <h2>Activate your merchant account</h2>

        {success ? (
          <>
            <p>Your account has been activated successfully.</p>
            <a href="/">Continue to merchant login</a>
          </>
        ) : (
          <form onSubmit={activate}>
            <p>Create your password to access the merchant dashboard.</p>

            {!token && (
              <p role="alert">
                This activation link is missing its token.
              </p>
            )}

            <label htmlFor="new-password">New password</label>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={loading || !token}
              style={styles.input}
            />

            <label htmlFor="confirm-password">Confirm password</label>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              disabled={loading || !token}
              style={styles.input}
            />

            {error && <p role="alert" style={styles.error}>{error}</p>}

            <button
              type="submit"
              disabled={loading || !token}
              style={styles.button}
            >
              {loading ? "Activating..." : "Activate account"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f5f7fb",
    padding: "20px",
    fontFamily: "Inter, system-ui, sans-serif"
  },
  card: {
    width: "100%",
    maxWidth: "420px",
    padding: "32px",
    background: "#fff",
    borderRadius: "16px",
    border: "1px solid #e4e7ec",
    boxSizing: "border-box" as const
  },
  input: {
    display: "block",
    width: "100%",
    padding: "12px",
    margin: "8px 0 20px",
    boxSizing: "border-box" as const
  },
  button: {
    width: "100%",
    padding: "12px",
    background: "#175cd3",
    color: "#fff",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer"
  },
  error: {
    color: "#b42318"
  }
};
