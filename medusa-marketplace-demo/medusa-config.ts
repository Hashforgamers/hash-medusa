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
    // Avoid connection bursts and stale idle connections on the hosted database.
    databaseDriverOptions: { pool: { min: 0, max: 5, idleTimeoutMillis: 10000 } },
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
    ...((process.env.RAZORPAY_CHECKOUT_MODE === 'live' || process.env.RAZORPAY_CHECKOUT_MODE === 'test' || (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET)) ? [{ resolve: "@medusajs/medusa/payment", options: { providers: [{ resolve: "./src/modules/razorpay", id: "razorpay", options: process.env.RAZORPAY_CHECKOUT_MODE ? { mode: process.env.RAZORPAY_CHECKOUT_MODE } : { key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET } }] } }] : []),
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
