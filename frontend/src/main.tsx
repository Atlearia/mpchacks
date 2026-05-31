import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { loadDataset } from "./data/dataset";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

function Splash({ message, error }: { message: string; error?: boolean }) {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#061027",
        color: error ? "#f4708a" : "#a6b8dd",
        fontFamily: "system-ui, sans-serif",
        gap: 16,
        textAlign: "center",
        padding: 24,
      }}
    >
      <div style={{ fontSize: 18, letterSpacing: 0.3 }}>{message}</div>
    </div>
  );
}

root.render(<Splash message="Loading expense intelligence…" />);

loadDataset()
  .then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  })
  .catch((err) => {
    console.error(err);
    root.render(
      <Splash
        error
        message="Couldn't load the dataset. Is the API running and MongoDB reachable?"
      />
    );
  });
