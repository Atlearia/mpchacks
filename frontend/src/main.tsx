import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Splash from "./components/Splash";
import { loadDataset } from "./data/dataset";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);

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
