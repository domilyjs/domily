import { transformDOMSingleFileComponentCode } from "./compiler";
import { merge, type VitePluginDomilyOptions } from "./compiler/utils";
import type { Plugin } from "vite";

export { type VitePluginDomilyOptions };

const sfcExt = [".d.md"];

const defaultOptions = {
  customElement: {
    enable: false,
    prefix: "d-",
  },
};

export default function domily(options?: VitePluginDomilyOptions) {
  const opt = merge<VitePluginDomilyOptions>(defaultOptions, options);
  const plugin: Plugin = {
    name: "vite:domily",
    transform(code, id) {
      if (sfcExt.some((e) => id.endsWith(e))) {
        let name = id.split("/").at(-1);
        sfcExt.forEach((e) => {
          name = name.replace(e, "");
        });
        return transformDOMSingleFileComponentCode(
          name,
          code,
          this.environment.mode,
          opt
        );
      }
    },
  };

  return plugin;
}
