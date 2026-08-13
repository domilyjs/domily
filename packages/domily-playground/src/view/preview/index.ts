import { computed, effect, ref, type ISignalFunc } from "domily";
import IconLoading from "@/assets/imgs/code-loading.svg";

export default function Preview(props: { code: ISignalFunc<string> }) {
  let url = "";

  const PAGE_LOADED_FLAG = "page-loaded";
  const notifyLoadCode = `<script>window.addEventListener("load", () => {
    (window.parent || window.top).postMessage("${PAGE_LOADED_FLAG}", location.origin);
  });</script>`;

  const notifyAbort = new AbortController();
  const loading = ref(false);
  const pageContainerCls = computed(() =>
    loading.value ? "page-container page-container-loading" : "page-container"
  );

  const mounted = (dom: HTMLIFrameElement | null) => {
    loading.value = true;
    effect(() => {
      if (!dom) {
        return;
      }
      if (url) {
        URL.revokeObjectURL(url);
      }
      const htmlFile = new Blob([props.code(), notifyLoadCode], {
        type: "text/html",
      });
      url = URL.createObjectURL(htmlFile);
      dom.src = url;
    });
    window.addEventListener(
      "message",
      (e) => {
        if (e.origin !== location.origin) {
          return;
        }
        if (e.data === PAGE_LOADED_FLAG) {
          loading.value = false;
        }
      },
      {
        signal: notifyAbort.signal,
      }
    );
  };

  const unmounted = () => {
    notifyAbort.abort();
  };

  return {
    tag: "section",
    customElement: {
      enable: true,
      name: "preview-browser",
      useShadowDOM: true,
      shadowDOMMode: "open",
    },
    css: {
      ".preview, .page-container": {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        overflow: "hidden",
      },
      ".page-container-loading": {
        backgroundImage: `url(${IconLoading})`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "center center",
        backgroundSize: "96px",
      },
    },
    className: "preview",
    children: [
      {
        tag: "iframe",
        className: pageContainerCls,
        attrs: {
          frameborder: 0,
        },
        mounted,
        unmounted,
      },
    ],
  };
}
