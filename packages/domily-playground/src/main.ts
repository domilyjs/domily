import { createApp } from "domily";
import App from "./app";
import router from "./routers";
import "./css.less";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
        scope: import.meta.env.BASE_URL,
      });
    } catch (error) {
      console.warn("Service worker registration failed.", error);
    }
  });
}

const { app, mount } = createApp(App);

app.use(router);

mount("#app");
