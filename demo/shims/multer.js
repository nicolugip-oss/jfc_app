// Mini-Multer für das Browser-Demo: liest Dateien aus FormData und legt sie im Demo-Speicher ab
import { files as store } from '../store.js';

class MulterError extends Error {
  constructor(code) { super(code); this.name = 'MulterError'; this.code = code; }
}

function multer({ storage, fileFilter } = {}) {
  const parse = (accept) => async (req, _res, next) => {
    const body = {};
    const files = {};
    const fd = req.rawBody;
    if (fd instanceof FormData) {
      for (const [field, value] of fd.entries()) {
        if (typeof value === 'string') { body[field] = value; continue; }
        if (!accept(field)) throw new MulterError('LIMIT_UNEXPECTED_FILE');
        const file = { fieldname: field, originalname: value.name || 'bild.jpg', mimetype: value.type || 'application/octet-stream', size: value.size };
        let ok = true;
        fileFilter?.(req, file, (_e, r) => { ok = r; });
        if (!ok) continue;
        storage.filename(req, file, (_e, name) => { file.filename = name; });
        store.put(file.filename, value);
        (files[field] ||= []).push(file);
      }
    }
    req.body = body;
    req.files = files;
    next();
  };
  return {
    fields: (defs) => {
      const names = defs.map((d) => d.name);
      return parse((f) => names.includes(f));
    },
    array: (name) => parse((f) => f === name),
    single: (name) => {
      const p = parse((f) => f === name);
      return async (req, res, next) => {
        await p(req, res, () => {});
        req.file = req.files[name]?.[0];
        delete req.files;
        next();
      };
    },
  };
}
multer.diskStorage = (opts) => opts;
multer.MulterError = MulterError;
export default multer;
