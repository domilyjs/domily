import { computed, render, type ISignalFunc } from "domily";
import useTheme from "@/store/theme";
import * as monaco from "monaco-editor";
import "./use-worker";

export default function Editor(props: { code: ISignalFunc<string> }) {
  const themeStore = useTheme((_, themeDetail) => {
    if (themeDetail === "dark") {
      monaco.editor.setTheme("vs-dark");
    }
    if (themeDetail === "light") {
      monaco.editor.setTheme("default");
    }
  });

  const editorInitialTheme = computed(() => {
    if (themeStore.theme === "dark") {
      return "vs-dark";
    }
    if (themeStore.theme === "light") {
      return "default";
    }
    if (themeStore.theme === "auto") {
      const matchMedia = window.matchMedia("(prefers-color-scheme: light)");
      return matchMedia.matches ? "default" : "vs-dark";
    }
    return "default";
  });

  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let contentChangeTimer: ReturnType<typeof setTimeout> | undefined;

  const mounted = (dom: HTMLElement | Node | null) => {
    if (!(dom instanceof HTMLElement)) {
      return;
    }

    const editorDOM = dom.querySelector<HTMLElement>(".editor");
    if (!editorDOM) {
      return;
    }
    const standaloneEditor = monaco.editor.create(editorDOM, {
      value: props.code(),
      language: "html",
      theme: editorInitialTheme.value,
      automaticLayout: true,
    });
    editor = standaloneEditor;

    standaloneEditor.getModel()?.onDidChangeContent(() => {
      clearTimeout(contentChangeTimer);
      contentChangeTimer = setTimeout(() => {
        props.code(standaloneEditor.getValue());
      }, 1000);
    });

    standaloneEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, async () => {
      await standaloneEditor.getAction("editor.action.formatDocument")?.run();
      props.code(standaloneEditor.getValue());
    });
  };

  const unmounted = () => {
    if (!editor) {
      return;
    }
    clearTimeout(contentChangeTimer);
    editor.dispose();
    editor = undefined;
  };

  return render({
    tag: "section",
    customElement: {
      enable: true,
      name: "code-editor",
      css: {
        ".editor": {
          width: "100%",
          height: "100%",
          ".read-only-line": {
            backgroundColor: "var(--read-only-background)",
            pointerEvents: "none",
            cursor: "not-allowed",
          },
          ".no-edit": {
            cursor: "not-allowed",
          },
        },
      },
    },
    className: "editor",
    mounted,
    unmounted,
  });
}
