import { reactive, type Ref, ref } from "domily";

class Req implements Disposable {
  url: string;
  loading: Ref<boolean>;
  reqInit?: RequestInit;
  response?: Response;
  constructor(url: string, req?: RequestInit & { loading?: Ref<boolean> }) {
    const { loading, ...reqInit } = req || {};
    this.url = url;
    this.loading = loading || ref(false);
    this.reqInit = reqInit;
    this.loading.value = true;
  }

  async fetch() {
    this.response = await fetch(this.url, this.reqInit);
  }

  [Symbol.dispose]() {
    this.loading.value = false;
  }
}

export default function MapList() {
  const loading = ref(false);
  const state = reactive<{
    data: {
      map: Map<string, string>;
      array: string[];
      set: Set<string>;
    };
    key: number;
  }>({
    data: {
      map: new Map(),
      array: [],
      set: new Set(),
    },
    key: 0,
  });
  const mounted = () => {
    document.querySelector("#global-loading")?.remove();
  };

  const nonReactiveObjStyle = {
    color: "blue",
  };

  const style = reactive({
    color: "green",
  });

  const getData = async () => {
    await using req = new Req("https://api.pearktrue.cn/api/countdownday/", {
      loading,
    });
    await req.fetch();
    if (!req.response) {
      throw new Error("Countdown API did not return a response");
    }
    const json = (await req.response.json()) as { data: string[] };
    style.color = "red";
    state.data.map = new Map(
      json.data.map((item, index) => [`${index}`, item]),
    );
    state.data.set = new Set(json.data);
    state.data.array = json.data;
  };

  const Loading = {
    tag: "div",
    domIf: () => loading.value,
    text: "Loading...",
  };

  return {
    key: () => `container-${state.key}`,
    tag: "fragment",
    className: "test-page",
    css: {
      ".test-page": {
        margin: "20px",
      },
    },
    mounted,
    style,
    children: [
      {
        tag: "button",
        text: "Get Data",
        style: "cursor: pointer",
        on: {
          click: () => {
            getData();
          },
        },
      },
      {
        tag: "button",
        text: "shift",
        style: "cursor: pointer",
        on: {
          click: () => {
            state.data.array.shift();
            state.data.map = new Map(
              state.data.array.map((item, index) => [`${index}`, item]),
            );
            state.data.set = new Set(state.data.array);
          },
        },
      },
      {
        tag: "button",
        text: "unshift",
        style: "cursor: pointer",
        on: {
          click: () => {
            const value = (Math.random() * 5000).toFixed(0) + "-" + Date.now();
            state.data.array.unshift(value);
            state.data.map = new Map(
              state.data.array.map((item, index) => [`${index}`, item]),
            );
            state.data.set = new Set(state.data.array);
          },
        },
      },
      {
        tag: "button",
        text: "pop",
        style: "cursor: pointer",
        on: {
          click: () => {
            state.data.map.delete(`${state.data.array.length - 1}`);
            const popData = state.data.array.pop();
            if (popData) {
              state.data.set.delete(popData);
            }
          },
        },
      },
      {
        tag: "button",
        text: "push",
        style: "cursor: pointer",
        on: {
          click: () => {
            const value = (Math.random() * 5000).toFixed(0) + "-" + Date.now();
            state.data.array.push(value);
            state.data.map.set(`${state.data.array.length - 1}`, value);
            state.data.set.add(value);
          },
        },
      },
      {
        tag: "button",
        text: () => `change Key: ${state.key}`,
        style: "cursor: pointer",
        on: {
          click: () => {
            const colors = [
              "#ff00f3",
              "#00f3ff",
              "#f3ff00",
              "#f300ff",
              "#00f300",
              "#ff0000",
              "#0000ff",
              "#00ff00",
              "#ff00ff",
              "#00ffff",
            ] as const;
            nonReactiveObjStyle.color =
              colors[Math.floor(Math.random() * colors.length)] ??
              nonReactiveObjStyle.color;
            state.key++;
          },
        },
      },
      {
        tag: "div",
        text: "非响应式对象更新测试内容",
        style: nonReactiveObjStyle,
      },
      {
        tag: "div",
        style: "display: flex; gap: 10px;",
        children: [
          {
            tag: "div",
            style:
              "width: 500px; height: 500px; overflow: auto; border: 1px solid #ccc;",
            children: [
              {
                tag: "h3",
                text: "Map Data",
              },
              Loading,
              {
                tag: "div",
                style:
                  'white-space: pre-wrap; font-family: "Courier New", Courier, monospace;',
                children: [
                  {
                    tag: "ul",
                    domIf: () => !loading.value,
                    mapList: {
                      list: () => state.data.map,
                      map: ([index, item]: [string, string]) => {
                        return {
                          tag: "li",
                          key: `list-${index}`,
                          text: item,
                        };
                      },
                    },
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            style:
              "width: 500px; height: 500px; overflow: auto; border: 1px solid #ccc;",
            children: [
              {
                tag: "h3",
                text: "Set Data",
              },
              Loading,
              {
                tag: "div",
                style:
                  'white-space: pre-wrap; font-family: "Courier New", Courier, monospace;',
                children: [
                  {
                    tag: "ul",
                    domIf: () => !loading.value,
                    mapList: {
                      list: () => state.data.set,
                      map: (item: string, index: number) => {
                        return {
                          tag: "li",
                          key: `list-${index}`,
                          text: item,
                        };
                      },
                    },
                  },
                ],
              },
            ],
          },
          {
            tag: "div",
            style:
              "width: 500px; height: 500px; overflow: auto; border: 1px solid #ccc;",
            children: [
              {
                tag: "h3",
                text: "Array Data",
              },
              Loading,
              {
                tag: "ul",
                domIf: () => !loading.value,
                mapList: {
                  list: () => state.data.array,
                  map: (item: string, index: number) => {
                    return {
                      tag: "li",
                      key: `list-${index}`,
                      text: item,
                    };
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  };
}
