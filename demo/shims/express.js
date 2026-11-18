// Mini-Express für das Browser-Demo: genug Router, damit server/routes.js unverändert läuft
function match(pattern, path) {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

// Führt eine Middleware aus; true = sie hat next() aufgerufen
async function step(handler, req, res) {
  let nextCalled = false;
  await handler(req, res, (err) => {
    if (err) throw err;
    nextCalled = true;
  });
  return nextCalled;
}

export class Router {
  constructor() { this.stack = []; }

  use(...args) {
    const prefix = typeof args[0] === 'string' ? args.shift() : '';
    this.stack.push({ prefix, handlers: args });
    return this;
  }

  // Gibt true zurück, wenn die Anfrage beantwortet wurde
  async handle(req, res, path) {
    for (const layer of this.stack) {
      if (!layer.method) {
        const p = layer.prefix;
        if (p && path !== p && !path.startsWith(`${p}/`)) continue;
        const sub = p ? path.slice(p.length) || '/' : path;
        for (const h of layer.handlers) {
          if (h instanceof Router) {
            if (await h.handle(req, res, sub)) return true;
          } else if (!(await step(h, req, res))) {
            return true;
          }
        }
        continue;
      }
      if (layer.method !== req.method) continue;
      const params = match(layer.path, path);
      if (!params) continue;
      req.params = params;
      for (const h of layer.handlers) if (!(await step(h, req, res))) return true;
      return true;
    }
    return false;
  }
}
for (const m of ['get', 'post', 'put', 'delete']) {
  Router.prototype[m] = function route(path, ...handlers) {
    this.stack.push({ method: m.toUpperCase(), path, handlers });
    return this;
  };
}

function express() { throw new Error('express() gibt es im Demo nicht'); }
express.Router = () => new Router();
express.json = () => (_req, _res, next) => next();
export default express;
