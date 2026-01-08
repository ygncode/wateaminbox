import { Hono } from 'hono'
import { loginRoutes } from './login.js'
import { passwordRoutes } from './password.js'
import { registerRoutes } from './register.js'
import { sessionRoutes } from './session.js'

export const authRoutes = new Hono()

// Register routes - POST /register, POST /verify-email
authRoutes.route('/', registerRoutes)

// Login routes - POST /login, POST /logout, POST /refresh
authRoutes.route('/', loginRoutes)

// Password routes - POST /forgot-password, POST /reset-password
authRoutes.route('/', passwordRoutes)

// Session routes - GET /sessions, DELETE /sessions, DELETE /sessions/:id, GET /me
authRoutes.route('/', sessionRoutes)
