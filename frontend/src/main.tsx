import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset } from "./data/dataset";
import "./index.css";

type Status = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };

function Root() {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then(() => !cancelled && setStatus({ kind: "ready" }))
      .catch((err: unknown) =>
        !cancelled &&
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Unknown error",
        })
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (status.kind === "loading") {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <div className="boot-text">Loading expense data…</div>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="boot">
        <div className="boot-text boot-error">Couldn’t load data</div>
        <div className="boot-sub">{status.message}</div>
        <div className="boot-sub">
          Make sure the API is running and MongoDB is reachable, then reload.
        </div>
      </div>
    );
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
