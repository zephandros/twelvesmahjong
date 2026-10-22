// El almacén de una sala, detrás de una interfaz.
//
// `RoomStore` es lo único que el cliente (net/client.ts) y el árbitro
// (net/host.ts) saben de Firebase: seis operaciones sobre rutas RELATIVAS a
// `rooms/{code}`. La implementación real (ui/firebase-store.ts) las traduce a
// la Realtime Database; `memoryStore()` las resuelve en memoria, y con él los
// tests juegan partidas enteras entre un anfitrión y varios invitados sin red
// (tests/net.test.ts), igual que el núcleo se testea sin DOM.

export type Unsub = () => void

export interface RoomStore {
  /** Lectura única. `null` si no existe o no se puede leer. */
  get<T>(path: string): Promise<T | null>
  set(path: string, value: unknown): Promise<void>
  /** Varias rutas de golpe, atómicamente. */
  update(values: Record<string, unknown>): Promise<void>
  remove(path: string): Promise<void>
  /** Escribe solo si el nodo está vacío (transacción). Devuelve si lo consiguió. */
  claim(path: string, value: unknown): Promise<boolean>
  /** Valor vivo de un nodo. Un error de permisos llega como `null`. */
  watch<T>(path: string, cb: (value: T | null) => void): Unsub
  /** Hijos de `path` por clave, a partir de `fromKey` incluido, los que haya y los que lleguen. */
  watchAppend<T>(path: string, fromKey: string, cb: (key: string, value: T) => void): Unsub
  /**
   * Presencia: deja `true` en `path` mientras haya conexión; el servidor lo
   * borra solo al caerse, y se reescribe al reconectar.
   */
  presence(path: string): Unsub
  /** Sentinela "hora del servidor" para `set`/`update`. */
  serverTimestamp(): unknown
  /** Desfase estimado reloj del servidor − reloj local (ms). */
  serverOffset(): number
}

// --- implementación en memoria ------------------------------------------------------

type Node = Map<string, Node> | unknown

const TS = Symbol('serverTimestamp')

/**
 * Un "servidor" en memoria: un árbol por sala, compartido por todos los
 * `RoomStore` que se abran sobre él. Cada escritura dispara los observadores
 * en un microtask, como hace el SDK de verdad (nunca de forma síncrona dentro
 * de la escritura, que es donde se esconden las carreras).
 */
export class MemoryBackend {
  private readonly roots = new Map<string, Map<string, Node>>()
  private readonly watchers: { room: string; path: string[]; fire: () => void }[] = []
  private readonly connections = new Map<MemoryStore, boolean>()
  now: () => number = () => Date.now()

  room(code: string, opts: { offset?: number } = {}): MemoryStore {
    const store = new MemoryStore(this, code, opts.offset ?? 0)
    this.connections.set(store, true)
    return store
  }

  /**
   * Simula la caída de un cliente (pestaña cerrada): se le borran sus
   * presencias, dejan de llegarle eventos y sus escrituras fallan.
   */
  disconnect(store: MemoryStore): void {
    this.connections.set(store, false)
    for (const p of store.presences) this.write(store.code, p, null)
    store.dropSubscriptions()
  }

  reconnect(store: MemoryStore): void {
    this.connections.set(store, true)
    for (const p of store.presences) this.write(store.code, p, true)
  }

  connected(store: MemoryStore): boolean {
    return this.connections.get(store) === true
  }

  /** Foto del subárbol (valor JSON plano, como `snapshot.val()`). */
  read(room: string, path: string[]): unknown {
    let node: Node = this.roots.get(room)
    for (const seg of path) {
      if (!(node instanceof Map)) return null
      node = node.get(seg)
    }
    return node === undefined ? null : plain(node)
  }

  write(room: string, path: string[], value: unknown): void {
    if (!this.roots.has(room)) this.roots.set(room, new Map())
    const root = this.roots.get(room)!
    const resolved = resolveTs(value, this.now())
    if (path.length === 0) {
      root.clear()
      const node = toNode(resolved)
      if (node instanceof Map) for (const [k, v] of node) root.set(k, v)
    } else {
      let node: Map<string, Node> = root
      for (const seg of path.slice(0, -1)) {
        const cur = node.get(seg)
        let next: Map<string, Node>
        if (cur instanceof Map) next = cur as Map<string, Node>
        else {
          next = new Map()
          node.set(seg, next)
        }
        node = next
      }
      const last = path[path.length - 1]!
      if (resolved === null || resolved === undefined) node.delete(last)
      else node.set(last, toNode(resolved))
      // podar vacíos hacia arriba, como RTDB (un nodo sin hijos no existe)
      prune(root, path.slice(0, -1))
    }
    const touched = [...this.watchers].filter(
      (w) => w.room === room && (isPrefix(w.path, path) || isPrefix(path, w.path)),
    )
    queueMicrotask(() => {
      for (const w of touched) if (this.watchers.includes(w)) w.fire()
    })
  }

  subscribe(store: MemoryStore, path: string[], fire: () => void): Unsub {
    const room = store.code
    const w = { room, path, fire }
    this.watchers.push(w)
    queueMicrotask(() => {
      if (this.watchers.includes(w)) fire()
    })
    const unsub = (): void => {
      const i = this.watchers.indexOf(w)
      if (i >= 0) this.watchers.splice(i, 1)
    }
    store.track(unsub)
    return unsub
  }
}

function isPrefix(a: string[], b: string[]): boolean {
  if (a.length > b.length) return false
  return a.every((seg, i) => seg === b[i])
}

function toNode(value: unknown): Node {
  if (value && typeof value === 'object') {
    const m = new Map<string, Node>()
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== null && v !== undefined) m.set(k, toNode(v))
    }
    return m
  }
  return value
}

/**
 * Como `snapshot.val()` de RTDB, con su heurística de arrays: si todas las
 * claves son enteros y más de la mitad entre 0 y la mayor tienen valor, sale
 * un ARRAY (con huecos), y si no, un objeto. Es a propósito que el almacén en
 * memoria la reproduzca: así los tests pasan por `seatsOf`/`fourOf`.
 */
function plain(node: Node): unknown {
  if (!(node instanceof Map)) return node
  const keys = [...node.keys()]
  const ints = keys.every((k) => /^(0|[1-9]\d*)$/.test(k))
  if (ints && keys.length > 0) {
    const max = Math.max(...keys.map(Number))
    if (keys.length > (max + 1) / 2) {
      const arr: unknown[] = new Array<unknown>(max + 1).fill(null)
      for (const [k, v] of node) arr[Number(k)] = plain(v)
      return arr
    }
  }
  const o: Record<string, unknown> = {}
  for (const [k, v] of node) o[k] = plain(v)
  return o
}

function prune(root: Map<string, Node>, path: string[]): void {
  for (let depth = path.length; depth > 0; depth--) {
    let node: Node = root
    for (const seg of path.slice(0, depth - 1)) {
      if (!(node instanceof Map)) return
      node = node.get(seg)
    }
    if (!(node instanceof Map)) return
    const child = node.get(path[depth - 1]!)
    if (child instanceof Map && child.size === 0) node.delete(path[depth - 1]!)
    else return
  }
}

function resolveTs(value: unknown, now: number): unknown {
  if (value === TS) return now
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTs(v, now)
    }
    return out
  }
  return value
}

const split = (path: string): string[] => path.split('/').filter(Boolean)

export class MemoryStore implements RoomStore {
  readonly presences: string[][] = []
  private readonly subs: Unsub[] = []

  track(unsub: Unsub): void {
    this.subs.push(unsub)
  }

  dropSubscriptions(): void {
    for (const u of this.subs) u()
    this.subs.length = 0
  }

  private guard(): void {
    if (!this.backend.connected(this)) throw new Error('disconnected')
  }

  constructor(
    private readonly backend: MemoryBackend,
    readonly code: string,
    private readonly offset: number,
  ) {}

  async get<T>(path: string): Promise<T | null> {
    this.guard()
    return this.backend.read(this.code, split(path)) as T | null
  }

  async set(path: string, value: unknown): Promise<void> {
    this.guard()
    this.backend.write(this.code, split(path), value)
  }

  async update(values: Record<string, unknown>): Promise<void> {
    this.guard()
    for (const [p, v] of Object.entries(values)) this.backend.write(this.code, split(p), v)
  }

  async remove(path: string): Promise<void> {
    this.guard()
    this.backend.write(this.code, split(path), null)
  }

  async claim(path: string, value: unknown): Promise<boolean> {
    this.guard()
    if (this.backend.read(this.code, split(path)) !== null) return false
    this.backend.write(this.code, split(path), value)
    return true
  }

  watch<T>(path: string, cb: (value: T | null) => void): Unsub {
    const p = split(path)
    return this.backend.subscribe(this, p, () => cb(this.backend.read(this.code, p) as T | null))
  }

  watchAppend<T>(path: string, fromKey: string, cb: (key: string, value: T) => void): Unsub {
    const p = split(path)
    const seen = new Set<string>()
    return this.backend.subscribe(this, p, () => {
      const all = (this.backend.read(this.code, p) ?? {}) as Record<string, T>
      for (const key of Object.keys(all).sort()) {
        if (key < fromKey || seen.has(key)) continue
        seen.add(key)
        cb(key, all[key]!)
      }
    })
  }

  presence(path: string): Unsub {
    const p = split(path)
    this.presences.push(p)
    if (this.backend.connected(this)) this.backend.write(this.code, p, true)
    return () => {
      const i = this.presences.indexOf(p)
      if (i >= 0) this.presences.splice(i, 1)
      this.backend.write(this.code, p, null)
    }
  }

  serverTimestamp(): unknown {
    return TS
  }

  serverOffset(): number {
    return this.offset
  }
}
