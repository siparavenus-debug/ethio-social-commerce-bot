
import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const PlatformApp = lazy(() => import("./PlatformApp"));
const ActivateOwner = lazy(() => import("./ActivateOwner"));

const pathname = window.location.pathname;

const isPlatform = /^\/platform(?:\/|$)/.test(pathname);
const isOwnerActivation = /^\/activate-owner\/?$/.test(pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isOwnerActivation ? (
      <Suspense fallback={<p>Loading account activation...</p>}>
        <ActivateOwner />
      </Suspense>
    ) : isPlatform ? (
      <Suspense fallback={<p>Loading platform administration...</p>}>
        <PlatformApp />
      </Suspense>
    ) : (
      <App />
    )}
  </React.StrictMode>
);
