import { signal, effect, type WithBaseProps } from "domily";
import Header from "../../components/header.d.md";
import Editor from "../editor";
import Preview from "../preview";
import { useRoute } from "@domily/router";
import { decode } from "js-base64";

export default function Layout({ namespace }: WithBaseProps) {
  let initialCode = `<style>
  body {
    margin: 0;
  }
</style>

<div id="app"></div>

<script type="module">
  import { ref, render } from 'https://cdn.jsdelivr.net/npm/@domily/runtime-core@latest/lib/index.esm.js';

  function App() {
    const count = ref(0);
    const css = {
      ".domily-example": {
        width: "100%",
        height: "100%",
        display: "flex",
        gap: "10px",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        background: "#191919",
        color: "#ffffff",
        ".logo": {
          height: "100px",
          animationName: "scale",
          animationDuration: "2s",
          animationPlayState: "running",
          animationIterationCount: "infinite",
          animationTimingFunction: "linear",
          "&:hover": {
            animationPlayState: "paused",
          },
        },
        button: {
          boxSizing: "border-box",
          cursor: "pointer",
          color: "#aac8e4",
          backgroundColor: "#2f2f2f",
          background: "linear-gradient(#2f2f2f, #2f2f2f) padding-box, linear-gradient(45deg, #fff500, #00e1ff) border-box",
          border: "2px solid transparent",
          fontSize: "16px",
          padding: "8px 18px",
          fontWeight: 500,
          borderRadius: "8px",
        },
      },
      "@keyframes scale": {
        "100%": {
          transform: "scale(1.2)"
        },
      }
    };
    return {
      tag: "fragment",
      customElement: {
        enable: true,
        name: "domily-counter-example",
        useShadowDOM: true,
        shadowDOMMode: "open",
        css,
      },
      className: "domily-example",
      children: [
        {
          tag: "img",
          className: "logo",
          props: {
            src: "https://raw.githubusercontent.com/domilyjs/domily/main/assets/logo.webp"
          }
        },
        {
          tag: "button",
          text: "Increment",
          on: {
            click: () => count.value++,
          },
        },
        {
          tag: "p",
          text: () => "Count:" + count.value,
        },
      ],
    };
  }

  render(App()).mount("#app");
</script>`;

  const route = useRoute(namespace);
  const codeFromQuery = route?.hash;

  if (codeFromQuery) {
    initialCode = decodeURIComponent(decode(codeFromQuery));
  }

  const code = signal(initialCode);

  const getPreviewURL = () => {
    const htmlFile = new Blob(
      [`<head><meta charset="UTF-8" /></head>\n\n`, code()],
      { type: "text/html" }
    );
    return URL.createObjectURL(htmlFile);
  };

  let url = "";
  let win: Window | null = null;
  const openInNewWindow = () => {
    url = getPreviewURL();
    const openedWindow = window.open(url);
    if (!openedWindow) {
      URL.revokeObjectURL(url);
      return;
    }

    win = openedWindow;
    openedWindow.onclose = () => {
      URL.revokeObjectURL(url);
      win = null;
    };
    effect(() => {
      if (!win) {
        return;
      }
      URL.revokeObjectURL(url);
      url = getPreviewURL();
      win.location.href = url;
    });
  };

  const mainMounted = () => {
    document.querySelector("#global-loading")?.remove();
  };

  return {
    tag: "div",
    css: {
      ".layout": {
        width: "100%",
        height: "100%",
      },
      ".main-container": {
        display: "flex",
        height: "calc(100% - var(--header-height))",
        "code-editor, preview-browser": {
          width: "50%",
        },
      },
    },
    className: "layout",
    children: [
      Header({
        openInNewWindow,
      }),
      {
        tag: "main",
        className: "main-container",
        children: [Editor({ code }), Preview({ code })],
        mounted: mainMounted,
      },
    ],
  };
}
