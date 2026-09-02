import { captureEvent, init, setTag, setUser } from "@openrum/browser";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const writeKey = import.meta.env.VITE_OPENRUM_WRITE_KEY || "orr_pk_replace_me";

init({
  writeKey,
  endpoint: import.meta.env.VITE_OPENRUM_ENDPOINT || "http://localhost:8081/ingest/v1/envelope",
  environment: "development",
  release: "react-example@0.1.0",
});
setUser("example-user-1042");
setTag("example", "react-vite");

function App() {
  const reportCustomEvent = () => {
    captureEvent("demo_checkout", {
      attributes: { plan: "self-hosted", source: "example" },
      measurements: { cart_value: 499.5 },
    });
  };

  const runAPIRequest = async () => {
    await fetch("/demo-api?private-query-is-removed=true").catch(() => undefined);
  };

  const reportError = () => {
    setTimeout(() => {
      throw new Error("OpenRUM example error");
    });
  };

  return (
    <main>
      <p className="eyebrow">OpenRUM SDK example</p>
      <h1>在一分钟内验证五类前端事件</h1>
      <p>页面打开会产生 Page View 和 Web Vital。下面的操作分别产生 Custom Event、API Request 和 Error。</p>
      <div className="actions">
        <button onClick={reportCustomEvent}>上报 Custom Event</button>
        <button onClick={() => void runAPIRequest()}>发起 API Request</button>
        <button className="danger" onClick={reportError}>触发 Error</button>
      </div>
      {writeKey === "orr_pk_replace_me" && <small>请先设置 VITE_OPENRUM_WRITE_KEY。</small>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
