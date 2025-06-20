#!/usr/bin/env node

import { WebSocketServer } from 'ws'
import http from 'http'
import * as map from 'lib0/map'

const wsReadyStateConnecting = 0
const wsReadyStateOpen = 1
const wsReadyStateClosing = 2 // eslint-disable-line
const wsReadyStateClosed = 3 // eslint-disable-line

const pingTimeout = 30000

const port = process.env.PORT || 4444
const allowedOrigins = process.env.API_ORIGINS ? process.env.API_ORIGINS.split(',') : []

const server = http.createServer((request, response) => {
  // Handle CORS for HTTP requests
  const origin = request.headers.origin

  if (allowedOrigins.includes('*')) {
    response.setHeader('Access-Control-Allow-Origin', '*')
  } else if (origin && allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
  }

  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')

  if (request.method === 'OPTIONS') {
    response.writeHead(200)
    response.end()
    return
  }

  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('Y-WebRTC Signaling Server is running')
})

const wss = new WebSocketServer({
  noServer: true,
  // Handle CORS for WebSocket connections
  verifyClient: (info) => {
    const origin = info.origin

    // If no origins specified, allow all
    if (allowedOrigins.length === 0) {
      return true
    }

    // Allow all origins if '*' is specified
    if (allowedOrigins.includes('*')) {
      return true
    }

    // Check if origin is in allowed list
    return origin && allowedOrigins.includes(origin)
  }
})

/**
 * Map froms topic-name to set of subscribed clients.
 * @type {Map<string, Set<any>>}
 */
const topics = new Map()

/**
 * @param {any} conn
 * @param {object} message
 */
const send = (conn, message) => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    conn.close()
  }
  try {
    conn.send(JSON.stringify(message))
  } catch (e) {
    conn.close()
  }
}

/**
 * Setup a new client
 * @param {any} conn
 */
const onconnection = conn => {
  /**
   * @type {Set<string>}
   */
  const subscribedTopics = new Set()
  let closed = false
  // Check if connection is still alive
  let pongReceived = true
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      conn.close()
      clearInterval(pingInterval)
    } else {
      pongReceived = false
      try {
        conn.ping()
      } catch (e) {
        conn.close()
      }
    }
  }, pingTimeout)
  conn.on('pong', () => {
    pongReceived = true
  })
  conn.on('close', () => {
    subscribedTopics.forEach(topicName => {
      const subs = topics.get(topicName) || new Set()
      subs.delete(conn)
      if (subs.size === 0) {
        topics.delete(topicName)
      }
    })
    subscribedTopics.clear()
    closed = true
  })
  conn.on('message', /** @param {object} message */ message => {
    if (typeof message === 'string' || message instanceof Buffer) {
      message = JSON.parse(message)
    }
    if (message && message.type && !closed) {
      switch (message.type) {
        case 'subscribe':
          /** @type {Array<string>} */ (message.topics || []).forEach(topicName => {
            if (typeof topicName === 'string') {
              // add conn to topic
              const topic = map.setIfUndefined(topics, topicName, () => new Set())
              topic.add(conn)
              // add topic to conn
              subscribedTopics.add(topicName)
            }
          })
          break
        case 'unsubscribe':
          /** @type {Array<string>} */ (message.topics || []).forEach(topicName => {
            const subs = topics.get(topicName)
            if (subs) {
              subs.delete(conn)
            }
          })
          break
        case 'publish':
          if (message.topic) {
            const receivers = topics.get(message.topic)
            if (receivers) {
              message.clients = receivers.size
              receivers.forEach(receiver =>
                send(receiver, message)
              )
            }
          }
          break
        case 'ping':
          send(conn, { type: 'pong' })
      }
    }
  })
}
wss.on('connection', onconnection)

server.on('upgrade', (request, socket, head) => {
  // Additional CORS check for WebSocket upgrade
  const origin = request.headers.origin

  if (allowedOrigins.length > 0 && !allowedOrigins.includes('*')) {
    if (!origin || !allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
  }

  /**
   * @param {any} ws
   */
  const handleAuth = ws => {
    wss.emit('connection', ws, request)
  }
  wss.handleUpgrade(request, socket, head, handleAuth)
})

server.listen(port)

console.log('Y-WebRTC Signaling server running on localhost:', port)
if (allowedOrigins.length > 0) {
  console.log('Allowed origins:', allowedOrigins.join(', '))
} else {
  console.log('CORS: All origins allowed (no API_ORIGINS specified)')
}