#!/usr/bin/env node
const WebSocket = require('ws')
const http = require('http')
const URL = require('url').URL
const path = require('path')
const fs = require('fs')
const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpg',
    '.gif': 'image/gif',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.woff': 'application/font-woff',
    '.ttf': 'application/font-ttf',
    '.eot': 'application/vnd.ms-fontobject',
    '.otf': 'application/font-otf',
    '.svg': 'application/image/svg+xml'
}

let log = Function.prototype
let port = parseInt(process.env.PORT) || 8080
let static = ''
let waitForStatic = 0

const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  switch (argv[i]) {
    case '--help':
    case '-h':
      console.log(`
Usage: wbr [options]

Options:
  --help, -h         Show help                                            [boolean]
  --version, -V, -v  Show version number                                  [boolean]
  --verbose          Add some logging about what the server is doing      [boolean]
  --port, -p         Start the server running on this port (default 8080)  [number]
  --static           Serve static files from this directory                [string]
  --wait-for-static  If the file can't be found, keep trying until this    [number]
                     amount of ms has passed.
`.trim())
      process.exit(1)
    case '--version':
    case '-v':
    case '-V':
      console.log(require('./package.json').verson)
      process.exit(1)
    case '-p':
    case '--port':
      port = parseInt(argv[(i += 1)])
      break
    case '--static':
      static = path.resolve(static)
      break
    case '--wait-for-static':
      waitForStatic = parseInt(argv[(i += 1)])
      break
    case '--verbose':
      log = console.log
      break
    default:
      break
  }
}

const server = http.createServer()
const wss = new WebSocket.Server({ noServer: true })

server.on('upgrade', (req, sock, head) => {
  wss.handleUpgrade(req, sock, head, ws => {
    wss.emit('connection', ws, req)
  })
})

const urlParamsToJson = url => {
  const payload = {}
  for(const [k,v] of url.searchParams) payload[k] = v
  return payload
}

const broadcast = (req, res, payload) => {
  log('--> broadcast ', payload)
  wss.clients.forEach(client => client.readyState === WebSocket.OPEN ? client.send(payload) : payload)
  res.write(payload)
  return res.end()
}

const serveFile = (req, res, filePath, start = Date.now()) => {
  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (waitForStatic && Date.now() - start < waitForStatic) {
        return setTimeout(serveFile, 100, req, res, filePath, start)
      }
      log('could not read', filePath, error)
      if(error.code == 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end(`Not found`, 'utf-8')
      } else {
        res.writeHead(500)
        res.end(`File could not be read`)
      }
    } else {
      log('--> static ', filePath)
      const extname = String(path.extname(filePath)).toLowerCase()
      res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' })
      res.end(content, 'utf-8')
    }
  })
}

const defaultIndex = (req, res) => {
  log('--> default index ')
  res.write(`<!DOCTYPE html>
    <script>
      console.log('opening websocket')
      const ws = new WebSocket('ws://localhost:${port}')
      ws.addEventListener('open', e => console.log('open', e))
      ws.addEventListener('message', e => console.log('data', e, JSON.parse(e.data)))
    </script>
  `)
  res.end()
}

server.on('request', (req, res) => {
  const url = new URL('http://wsb' + req.url)
  log('<-- ', req.url)
  if (url.pathname === '/b') return broadcast(req, res, JSON.stringify(urlParamsToJson(url), null, 2))
  if (static) return serveFile(req, res, path.join(static, url.pathname === '/' ? '/index.html' : url.pathname))
  return defaultIndex(req, res)
})

server.listen(port)
console.log('wsb listening on', port)
