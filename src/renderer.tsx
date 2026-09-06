/** @jsxImportSource hono/jsx */
import { jsxRenderer } from 'hono/jsx-renderer'
import { Link, Script, ViteClient } from 'vite-ssr-components/hono'

// @vitejs/plugin-react's React Refresh preamble is normally injected by Vite's
// transformIndexHtml hook, which only runs for a static index.html. This app's
// HTML is generated server-side, so that hook never fires and every
// react-refresh-instrumented module throws "can't detect preamble" on load.
const ReactRefreshPreamble = () => {
  if (import.meta.env && import.meta.env.PROD) return null
  return (
    <script
      type="module"
      // biome-ignore lint: raw preamble script must run before any React module
      dangerouslySetInnerHTML={{
        __html: `import RefreshRuntime from "/@react-refresh"
RefreshRuntime.injectIntoGlobalHook(window)
window.$RefreshReg$ = () => {}
window.$RefreshSig$ = () => (type) => type
window.__vite_plugin_react_preamble_installed__ = true`,
      }}
    />
  )
}

export const renderer = jsxRenderer(({ children }) => {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>レシート記録</title>
        <ViteClient />
        <ReactRefreshPreamble />
        <Link href="/src/style.css" rel="stylesheet" />
      </head>
      <body>
        {children}
        <Script src="/src/client/main.tsx" />
      </body>
    </html>
  )
})
