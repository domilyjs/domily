import { transformDOMSingleFileComponentCode } from "./compiler";
import { merge, type VitePluginDomilyOptions } from "./compiler/utils";
import { transformWithOxc, type Plugin } from "vite";

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
    async transform(code, id) {
      if (sfcExt.some((e) => id.endsWith(e))) {
        const filename = id.split("/").at(-1);
        if (!filename) return;

        const name = sfcExt.reduce(
          (value, extension) => value.replace(extension, ""),
          filename,
        );
        return transformDOMSingleFileComponentCode(
          name,
          code,
          this.environment.mode,
          opt,
          {
            parse: (source, parserOptions) => ({ program: this.parse(source, parserOptions) }),
            transform: async (source, filename, transformOptions) => {
              const transformed = await transformWithOxc(source, filename, transformOptions);
              return {
                code: transformed.code,
                ...(transformed.map ? { map: transformed.map } : {}),
              };
            },
          },
          id,
        );
      }
    },
  };

  return plugin;
}
