// Ersatz für node:path im Browser-Demo
const basename = (p) => String(p).split('/').pop();
export default {
  resolve: (p) => String(p),
  join: (...parts) => parts.join('/'),
  basename,
  dirname: (p) => String(p).split('/').slice(0, -1).join('/'),
};
