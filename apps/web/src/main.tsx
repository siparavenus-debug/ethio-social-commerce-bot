import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const PlatformApp = lazy(() => import("./PlatformApp"));
const isPlatform = /^\/platform(?:\/|$)/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isPlatform ? <Suspense fallback={<p>Loading platform administration…</p>}><PlatformApp /></Suspense> : <App />}
  </React.StrictMode>
);
