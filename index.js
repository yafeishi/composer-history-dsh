/**
 * Host half: persistent, machine-local store of the prompts the user sent,
 * so composer history works across conversations.
 *
 * One JSON file under the Harness home (storages/composer-history.json),
 * written atomically. Read-only to the browser; the Host owns the file.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

const ROUTE = '/api/composer-history'
const MAX_ITEMS = 500

export const inject = ['webServer']

function storageFile() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'storages', 'composer-history.json')
}

let cache = null

async function loadItems() {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(storageFile(), 'utf8'))
    cache = Array.isArray(parsed.items) ? parsed.items.filter((x) => typeof x === 'string') : []
  } catch {
    cache = []
  }
  return cache
}

async function saveItems(items) {
  cache = items
  const file = storageFile()
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ items }, null, 2))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 512 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          json(res, 200, { items: await loadItems() })
          return
        }
        if (req.method === 'POST') {
          const body = JSON.parse(await readBody(req) || '{}')
          const text = typeof body.text === 'string' ? body.text.trim() : ''
          if (!text) {
            json(res, 200, { ok: true, ignored: true })
            return
          }
          const items = await loadItems()
          if (items[items.length - 1] !== text) {
            items.push(text)
            while (items.length > MAX_ITEMS) items.shift()
            await saveItems(items)
          }
          json(res, 200, { ok: true, count: items.length })
          return
        }
        json(res, 405, { error: 'method not allowed' })
      } catch (error) {
        json(res, 500, { error: String(error && error.message || error) })
      }
    },
  }), 'composer-history: store route')
}
