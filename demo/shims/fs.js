// Ersatz für node:fs im Browser-Demo (nur was der Server-Code braucht)
import { files } from '../store.js';

export default {
  mkdirSync() {},
  existsSync: () => false,
  rm(path, _opts, cb) {
    files.remove(String(path).split('/').pop());
    cb?.();
  },
};
