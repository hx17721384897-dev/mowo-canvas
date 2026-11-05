import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: ["./src/features/assets/server/schema.ts", "./src/features/ai/server/schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: "./data/app.db",
  },
});
