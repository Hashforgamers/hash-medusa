import { loadEnv, defineConfig, Modules } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

const useRedis = !!process.env.REDIS_URL && (process.env.NODE_ENV === 'production' || process.env.HASH_USE_REDIS === 'true')

module.exports = defineConfig({
  admin: {
    vite: () => {
      return {
        optimizeDeps: {
          include: ["qs"],
        },
      };
    },
  },
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: useRedis ? process.env.REDIS_URL : undefined,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || "supersecret",
      cookieSecret: process.env.COOKIE_SECRET || "supersecret",
    }
  },
  // Redis-backed infrastructure is enabled on the hosted deployment.
  modules: [
    { resolve: "@medusajs/medusa/auth", options: { providers: [
      { resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" },
      { resolve: "./src/modules/hfg-auth", id: "hfg" },
    ] } },
    ...(useRedis ? [
    { key: Modules.CACHE, resolve: "@medusajs/cache-redis", options: { redisUrl: process.env.REDIS_URL } },
    { key: Modules.EVENT_BUS, resolve: "@medusajs/event-bus-redis", options: { redisUrl: process.env.REDIS_URL } },
    { key: Modules.WORKFLOW_ENGINE, resolve: "@medusajs/workflow-engine-redis", options: { redis: { url: process.env.REDIS_URL } } },
    { key: Modules.LOCKING, resolve: "@medusajs/locking", options: { providers: [
      { resolve: "@medusajs/locking-redis", id: "redis", is_default: true, options: { redisUrl: process.env.REDIS_URL } },
    ] } },
  ] : []),
  ],
})
