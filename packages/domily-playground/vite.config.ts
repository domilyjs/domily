import { defineConfig } from "vite";
import domily from "vite-plugin-domily";
import { fileURLToPath } from "url";

export default defineConfig({
  plugins: [domily()],
  base: "/domily",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
