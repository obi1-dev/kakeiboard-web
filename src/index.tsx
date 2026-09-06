/** @jsxImportSource hono/jsx */
import { Hono } from 'hono'
import { renderer } from './renderer'
import { paymentMethodsRoutes } from './api/payment-methods'
import { receiptsRoutes } from './api/receipts'
import { exportRoutes } from './api/export'
import { ocrRoutes } from './api/ocr'

const app = new Hono<{ Bindings: CloudflareBindings }>()

app.route('/api/payment-methods', paymentMethodsRoutes)
app.route('/api', receiptsRoutes)
app.route('/api', exportRoutes)
app.route('/api/ocr', ocrRoutes)

app.all('/api/*', (c) => c.json({ error: 'not found' }, 404))

app.use(renderer)
app.get('*', (c) => c.render(<div id="root"></div>))

export default app
