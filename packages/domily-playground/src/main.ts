import { createApp } from "domily";
import App from "./app";
import router from "./routers";
import "./css.less";

if ("serviceWorker" in navigator) {
  const serviceWorkerScope = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(
        `${serviceWorkerScope}sw.js`,
        {
          scope: serviceWorkerScope,
        },
      );
    } catch (error) {
      console.warn("Service worker registration failed.", error);
    }
  });
}

const { app, mount } = createApp(App);

app.use(router);

mount("#app");
