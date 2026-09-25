import { MobileRuntime } from "./mobile";
import Prototype from "./Prototype";

export default function App() {
  // The device shell belongs to the explicit developer preview only.
  if (new URLSearchParams(window.location.search).get("preview") === "1") {
    return <MobileRuntime><Prototype /></MobileRuntime>;
  }

  return <Prototype />;
}
