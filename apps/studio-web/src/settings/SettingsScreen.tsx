// The Settings screen (Story 39.2): the Sandbox login card first, then Story 39.8's model and effort part, still a
// named placeholder (`PLACEHOLDER.settings`).
import { PLACEHOLDER } from "../screen";
import { LoginCard } from "./LoginCard";

const pageText = { position: "absolute", inset: 0, padding: "48px 16px 16px", font: "13px/1.4 ui-monospace, Menlo, Consolas, monospace", color: "#e8e8e8", background: "#161616", overflow: "auto" } as const;

export function SettingsScreen() {
  return (
    <div style={pageText}>
      <LoginCard />
      <div>Model and effort: {PLACEHOLDER.settings}</div>
    </div>
  );
}
