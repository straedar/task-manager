import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DialogProvider } from "./DialogContext";
import { applyUiTheme, readUiTheme, UiThemeProvider } from "./uiTheme";
import "./styles.css";
import "./theme-dark.css";

applyUiTheme(readUiTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiThemeProvider>
      <DialogProvider>
        <App />
      </DialogProvider>
    </UiThemeProvider>
  </StrictMode>,
);
