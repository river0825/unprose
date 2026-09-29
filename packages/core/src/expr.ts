// A deliberately small expression language. No eval, no prototype access,
// no assignment. Enough for `event.data.to == 'Ready' && len(vars.plan.tasks) > 0`.
//
//   literals      'str' "str" 123 1.5 true false null [a, b]
//   access        a.b  a[0]  a['k']
//   operators     ! - (unary)  * /  + -  < <= > >=  == !=  in  &&  ||  ?:
//   functions     len lower upper startsWith endsWith includes json default trim split join keys number string

export type Scope = Record<string, unknown>

type Tok =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: 'eof' }

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '!', '+', '-', '*', '/', '(', ')', '[', ']', '.', ',', '?', ':']

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[0-9]/.test(c)) {
      const m = /^\d+(\.\d+)?/.exec(src.slice(i))!
      out.push({ t: 'num', v: Number(m[0]) }); i += m[0].length; continue
    }
    if (c === "'" || c === '"') {
      let j = i + 1, s = ''
      while (j < src.length && src[j] !== c) {
        if (src[j] === '\\' && j + 1 < src.length) { j++; s += ({ n: '\n', t: '\t' } as Record<string, string>)[src[j]] ?? src[j] }
        else s += src[j]
        j++
      }
      if (j >= src.length) throw new Error(`unterminated string at ${i}`)
      out.push({ t: 'str', v: s }); i = j + 1; continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(src.slice(i))!
      out.push({ t: 'id', v: m[0] }); i += m[0].length; continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new Error(`unexpected character "${c}" at ${i} in: ${src}`)
    out.push({ t: 'op', v: op }); i += op.length
  }
  out.push({ t: 'eof' })
  return out
}

export type Node =
  | { k: 'lit'; v: unknown }
  | { k: 'id'; name: string }
  | { k: 'member'; obj: Node; prop: Node }
  | { k: 'call'; fn: string; args: Node[] }
  | { k: 'unary'; op: string; x: Node }
  | { k: 'binary'; op: string; l: Node; r: Node }
  | { k: 'cond'; c: Node; a: Node; b: Node }
  | { k: 'array'; items: Node[] }

// Precedence climbing (a Pratt parser without the ceremony).
const BIN_PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, in: 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7 }

export function parse(src: string): Node {
  const toks = tokenize(src)
  let p = 0
  const peek = () => toks[p]
  const next = () => toks[p++]
  const isOp = (v: string) => { const t = peek(); return t.t === 'op' && t.v === v }
  const isKw = (v: string) => { const t = peek(); return t.t === 'id' && t.v === v }
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`expected "${v}" in: ${src}`); next() }

  function primary(): Node {
    const t = next()
    if (t.t === 'num' || t.t === 'str') return postfix({ k: 'lit', v: t.v })
    if (t.t === 'id') {
      if (t.v === 'true') return postfix({ k: 'lit', v: true })
      if (t.v === 'false') return postfix({ k: 'lit', v: false })
      if (t.v === 'null' || t.v === 'undefined') return postfix({ k: 'lit', v: null })
      if (isOp('(')) {
        next()
        const args: Node[] = []
        while (!isOp(')')) { args.push(expr(0)); if (isOp(',')) next(); else break }
        expect(')')
        return postfix({ k: 'call', fn: t.v, args })
      }
      return postfix({ k: 'id', name: t.v })
    }
    if (t.t === 'op') {
      if (t.v === '(') { const e = expr(0); expect(')'); return postfix(e) }
      if (t.v === '[') {
        const items: Node[] = []
        while (!isOp(']')) { items.push(expr(0)); if (isOp(',')) next(); else break }
        expect(']')
        return postfix({ k: 'array', items })
      }
      if (t.v === '!' || t.v === '-') return { k: 'unary', op: t.v, x: unaryOperand() }
    }
    throw new Error(`unexpected token ${JSON.stringify(t)} in: ${src}`)
  }
  function unaryOperand(): Node { return primary() }

  function postfix(n: Node): Node {
    for (;;) {
      if (isOp('.')) { next(); const id = next(); if (id.t !== 'id') throw new Error(`expected name after "." in: ${src}`); n = { k: 'member', obj: n, prop: { k: 'lit', v: id.v } }; continue }
      if (isOp('[')) { next(); const idx = expr(0); expect(']'); n = { k: 'member', obj: n, prop: idx }; continue }
      return n
    }
  }

  function expr(minPrec: number): Node {
    let left = primary()
    for (;;) {
      const t = peek()
      const op = t.t === 'op' ? t.v : t.t === 'id' && t.v === 'in' ? 'in' : undefined
      if (op === '?' && minPrec === 0) {
        next(); const a = expr(0); expect(':'); const b = expr(0)
        left = { k: 'cond', c: left, a, b }; continue
      }
      if (!op || !(op in BIN_PREC) || BIN_PREC[op] < minPrec) return left
      next()
      const right = expr(BIN_PREC[op] + 1)
      left = { k: 'binary', op, l: left, r: right }
    }
  }

  const n = expr(0)
  if (peek().t !== 'eof') throw new Error(`unexpected trailing input in: ${src}`)
  return n
}

const FUNCS: Record<string, (...a: any[]) => unknown> = {
  len: (x) => (x == null ? 0 : typeof x === 'string' || Array.isArray(x) ? x.length : typeof x === 'object' ? Object.keys(x).length : 0),
  lower: (x) => String(x ?? '').toLowerCase(),
  upper: (x) => String(x ?? '').toUpperCase(),
  trim: (x) => String(x ?? '').trim(),
  startsWith: (x, y) => String(x ?? '').startsWith(String(y)),
  endsWith: (x, y) => String(x ?? '').endsWith(String(y)),
  includes: (x, y) => (Array.isArray(x) ? x.includes(y) : String(x ?? '').includes(String(y))),
  json: (x) => JSON.stringify(x),
  default: (x, d) => (x === undefined || x === null || x === '' ? d : x),
  split: (x, sep) => String(x ?? '').split(String(sep)),
  join: (x, sep) => (Array.isArray(x) ? x.join(String(sep ?? ',')) : String(x ?? '')),
  keys: (x) => (x && typeof x === 'object' ? Object.keys(x) : []),
  number: (x) => Number(x),
  string: (x) => (x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : String(x)),
}

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype'])

function member(obj: unknown, prop: unknown): unknown {
  if (obj === null || obj === undefined) return undefined
  const key = typeof prop === 'number' ? prop : String(prop)
  if (typeof key === 'string' && BLOCKED.has(key)) return undefined
  if (typeof obj !== 'object' && typeof obj !== 'string') return undefined
  if (typeof obj === 'string') return key === 'length' ? obj.length : typeof key === 'number' ? obj[key] : undefined
  if (!Object.prototype.hasOwnProperty.call(obj, key)) return undefined
  return (obj as Record<string | number, unknown>)[key]
}

function loose(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a == null && b == null
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return String(a) === String(b)
}

export function evaluate(node: Node, scope: Scope): unknown {
  switch (node.k) {
    case 'lit': return node.v
    case 'id': return Object.prototype.hasOwnProperty.call(scope, node.name) ? scope[node.name] : undefined
    case 'array': return node.items.map((i) => evaluate(i, scope))
    case 'member': return member(evaluate(node.obj, scope), evaluate(node.prop, scope))
    case 'call': {
      const fn = FUNCS[node.fn]
      if (!fn) throw new Error(`unknown function ${node.fn}()`)
      return fn(...node.args.map((a) => evaluate(a, scope)))
    }
    case 'unary': {
      const x = evaluate(node.x, scope)
      return node.op === '!' ? !truthy(x) : -Number(x)
    }
    case 'cond': return truthy(evaluate(node.c, scope)) ? evaluate(node.a, scope) : evaluate(node.b, scope)
    case 'binary': {
      if (node.op === '&&') { const l = evaluate(node.l, scope); return truthy(l) ? evaluate(node.r, scope) : l }
      if (node.op === '||') { const l = evaluate(node.l, scope); return truthy(l) ? l : evaluate(node.r, scope) }
      const l = evaluate(node.l, scope), r = evaluate(node.r, scope)
      switch (node.op) {
        case '==': return loose(l, r)
        case '!=': return !loose(l, r)
        case '<': return (l as number) < (r as number)
        case '<=': return (l as number) <= (r as number)
        case '>': return (l as number) > (r as number)
        case '>=': return (l as number) >= (r as number)
        case '+': return typeof l === 'string' || typeof r === 'string' ? String(l ?? '') + String(r ?? '') : Number(l) + Number(r)
        case '-': return Number(l) - Number(r)
        case '*': return Number(l) * Number(r)
        case '/': return Number(l) / Number(r)
        case 'in':
          if (Array.isArray(r)) return r.some((x) => loose(x, l))
          if (typeof r === 'string') return r.includes(String(l))
          if (r && typeof r === 'object') return Object.prototype.hasOwnProperty.call(r, String(l))
          return false
      }
      throw new Error(`unknown operator ${node.op}`)
    }
  }
}

export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  return !!v
}

const cache = new Map<string, Node>()
export function compile(src: string): Node {
  let n = cache.get(src)
  if (!n) { n = parse(src); cache.set(src, n) }
  return n
}

export function evalExpr(src: string, scope: Scope): unknown {
  return evaluate(compile(src), scope)
}

export function evalCondition(src: string | undefined, scope: Scope): boolean {
  if (src === undefined || src.trim() === '' || src.trim() === 'true') return true
  return truthy(evalExpr(src, scope))
}

const TEMPLATE_RE = /\{\{\s*([\s\S]+?)\s*\}\}/g

/**
 * `"Hello {{ name }}"` → `"Hello River"`. A string that is exactly one
 * template returns the raw value (number, object, …) instead of a string.
 */
export function template(str: string, scope: Scope): unknown {
  const whole = /^\s*\{\{\s*([\s\S]+?)\s*\}\}\s*$/.exec(str)
  if (whole) return evalExpr(whole[1], scope)
  return str.replace(TEMPLATE_RE, (_m, e: string) => {
    const v = evalExpr(e, scope)
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

export function templateDeep<T>(value: T, scope: Scope): T {
  if (typeof value === 'string') return template(value, scope) as T
  if (Array.isArray(value)) return value.map((v) => templateDeep(v, scope)) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = templateDeep(v, scope)
    return out as T
  }
  return value
}

/** Names of the root identifiers an expression touches (for lint). */
export function rootIdentifiers(src: string): string[] {
  const out = new Set<string>()
  const walk = (n: Node) => {
    switch (n.k) {
      case 'id': out.add(n.name); break
      case 'member': walk(n.obj); walk(n.prop); break
      case 'call': n.args.forEach(walk); break
      case 'unary': walk(n.x); break
      case 'binary': walk(n.l); walk(n.r); break
      case 'cond': walk(n.c); walk(n.a); walk(n.b); break
      case 'array': n.items.forEach(walk); break
    }
  }
  walk(compile(src))
  return [...out]
}

/** Every `{{ expr }}` inside a template string. */
export function templateExpressions(str: string): string[] {
  return [...str.matchAll(TEMPLATE_RE)].map((m) => m[1])
}
