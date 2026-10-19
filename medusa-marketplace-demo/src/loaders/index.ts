import { asValue } from "awilix"

export default async ({ container, app }) => {
  // Always have a default (so workflows won’t crash)
  if (!container.hasRegistration("loggedInUser")) {
    container.register({
      loggedInUser: asValue(null),
    })
  }

  // Per-request override (only works for APIs, not workflows)
  app.use((req, res, next) => {
    const scope = req.scope
    scope.register({
      loggedInUser: asValue(req.user || null),
    })
    next()
  })
}
