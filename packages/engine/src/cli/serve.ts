// A static file server on a free 127.0.0.1 port, for playing a directory
// package (fetch needs http; a `file://` page cannot load one).

import { readFile, stat } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { join, normalize, resolve, sep } from 'node:path'
import { mimeOf } from '../pack.js'

export interface Served {
  url: string
  close(): Promise<void>
}

export async function serveDirectory(dir: string): Promise<Served> {
  const root = resolve(dir)
  const server: Server = createServer((req, res) => {
    void (async () => {
      try {
        let file = normalize(join(root, decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)))
        if (file !== root && !file.startsWith(root + sep)) throw new Error('outside')
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
        const body = await readFile(file)
        res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : mimeOf(file), 'cache-control': 'no-store' })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end()
      }
    })()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r())) }
}
