import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Only migrate/introspect read this. The app connects through the driver
  // adapter in src/lib/db.ts instead.
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
