import path from "node:path";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: path.join(__dirname, "prisma", "schema.prisma"),
  datasource: {
    // Primary connection (pooled in production via PgBouncer)
    url: process.env.DATABASE_URL,
    // Direct non-pooled connection for migrations (Prisma v7 uses shadowDatabaseUrl
    // for the non-pooled connection, equivalent to directUrl in schema.prisma v5/v6)
    shadowDatabaseUrl: process.env.DIRECT_URL,
  },
});
