#!/usr/bin/env node
const WebSocket = require('ws')
const http = require('http')
const URL = require('url').URL
const {createGzip} = require('zlib')
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
const compressable = ['.html', '.js', '.css', '.json']

let log = Function.prototype
let port = parseInt(process.env.PORT) || 8080
let static = ''
let waitForStatic = 0
let pausableStatic = false
let compress = false
let paused = Promise.resolve()

const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i += 1) {
  switch (argv[i]) {
    case '--help':
    case '-h':
      console.log(`
Usage: wsb [options]

Options:
  --help, -h         Show help                                            [boolean]
  --version, -V, -v  Show version number                                  [boolean]
  --verbose          Add some logging about what the server is doing      [boolean]
  --port, -p         Start the server running on this port (default 8080)  [number]
  --static           Serve static files from this directory                [string]
  --pauseable-static Make a static server that can be paused via the API   [string]
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
      static = path.resolve(argv[(i += 1)])
      break
    case '--wait-for-static':
      waitForStatic = parseInt(argv[(i += 1)])
      break
    case '--pausable-static':
      static = path.resolve(argv[(i += 1)])
      pausableStatic = true
      break
    case '--verbose':
      log = console.log
      break
    case '-c':
    case '--compress':
      compress = true
      break
    default:
      throw new Error(`unknown option ${argv[i]}`)
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

const baseHandler = (req, res, next, error) => {
  log('--> default')
  if (!error) error = Object.assign(new Error(`Could not ${req.method} ${req.url.pathname}`), { status: 404 })
  if (error.code === 'ENOENT') res.writeHead(404)
  if (error.status) res.writeHead(error.status)
  res.write(`<!DOCTYPE html>
    <script>
      console.log('opening websocket')
      const ws = new WebSocket('ws://localhost:${port}')
      ws.addEventListener('open', e => console.log('open', e))
      ws.addEventListener('message', e => console.log('data', e, JSON.parse(e.data)))
    </script>
    <pre>${error && error.stack}</pre>
  `)
  res.end()
}
const middlewares = []
server.add = cb => (middlewares.push(cb), server)
server.on('request', (req, res) => {
  req.url = new URL(`http://${req.headers.host || `localhost:${port}`}${req.url}`)
  log('<-- ', req.method, req.url.toString())
  const stack = middlewares.filter(m => m.length < 4)
  const errorStack = middlewares.filter(m => m.length === 4)
  const next = error => {
    const middleware = error ? errorStack.shift() : stack.shift()
    if (!middleware) return baseHandler(req, res, next, error)
    try {
      middleware(req, res, next, error)
    } catch(error) {
      (errorStack.pop() || baseHandler)(req, res, next, error)
    }
  }
  next()
})

server.add((req, res, next) => {
  if (req.url.pathname !== '/b') return next()
  const payload = {}
  for(const [k,v] of req.url.searchParams) payload[k] = v
  log('--> broadcast ', payload)
  wss.clients.forEach(client => client.readyState === WebSocket.OPEN ? client.send(JSON.stringify(payload)) : payload)
  res.write(JSON.stringify(payload, null, 2))
  return res.end()
})

if (pausableStatic) {
  let resolver
  server.add((req, res, next) => {
    if (req.url.pathname !== '/pause') return next()
    log('--> pausing')
    paused = new Promise(resolve => resolver = resolve)
    res.end('pausing static server')
  })
  server.add((req, res, next) => {
    if (req.url.pathname !== '/unpause') return next()
    log('--> unpausing')
    resolver()
    res.end('unpausing static server')
  })
}

if (static) {
  const waitForFile = (file, timeout) => {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const tryFile = () => {
        fs.access(file, error => {
          if (!error) return resolve(file)
          if (error.code !== 'ENOENT') return reject(error)
          if (Date.now() - start > timeout) {
            error.message = `Timed out waiting for ${file}`
            return reject(error)
          }
          setTimeout(tryFile, 100)
        })
      }
      tryFile()
    })
  }
  server.add((req, res, next) => {
    log('--> static')
    const file = path.join(static, req.url.pathname)
    let prom = Promise.resolve()
    if (pausableStatic) {
      prom = prom.then(() => log(`waiting for server to unpause`) || paused)
    }
    if (waitForStatic) {
      prom = prom.then(() => log(`waiting for ${file} for ${waitForStatic / 1000}s`) || waitForFile(file, waitForStatic))
    }
    prom.then(() => {
      const extname = String(path.extname(req.url.pathname)).toLowerCase()
      let stream = fs.createReadStream(file).on('error', next)
      const acceptHeader = req.headers['accept-encoding'] || ''
      if (compress && acceptHeader.includes('gzip') && compressable.includes(extname)) {
        res.setHeader('Content-Encoding', 'gzip')
        stream = stream.pipe(createGzip({}))
      }
      res.writeHead(200, { 'Content-Type': mimeTypes[extname] || 'application/octet-stream' })
      stream.pipe(res)
    }).catch(next)
  })
}

server.listen(port)
console.log('wsb listening on', port)

module.exports = server
