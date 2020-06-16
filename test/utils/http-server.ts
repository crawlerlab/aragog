import url from 'url'
import http from 'http'
import { EventEmitter } from 'events'

const getHtml = (html: string): string => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TestDocument</title>
</head>
<body>
  <div>${html}</div>
</body>
</html>
`

interface CustomRes {
  html: (body: string) => void
}

class HttpServer extends EventEmitter {
  server: http.Server

  constructor() {
    super()
    this.server = http.createServer((req, rawRes) => {
      const res = rawRes as http.ServerResponse & CustomRes
      res.setHeader('Content-Type', 'text/html')
      res.html = (body: string): void => res.end(getHtml(body))
      const { pathname } = url.parse(req.url || '')
      const dataKey = pathname ? pathname.split('/')[1] : '/'
      this.emit(dataKey, req, res)
    })
  }

  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.on('error', reject)
      this.server.listen(port, resolve)
    })
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })
  }
}

export default HttpServer
