import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  const apiPort = process.env.WEBBED_API_PORT ?? "8787";

  return {
    plugins: [react()],
    server: {
      host: "127.0.0.1",
      port: 5177,
      proxy: {
        "/api": `http://127.0.0.1:${apiPort}`,
      },
    },
  };
});
