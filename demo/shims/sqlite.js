// Ersatz für node:sqlite im Browser: dieselbe API (prepare().get/all/run), dahinter sql.js (SQLite als WebAssembly)
const dirty = () => globalThis.__demoMarkDirty?.();

export class DatabaseSync {
  constructor() {
    this.db = new globalThis.__SQL.Database(globalThis.__DEMO_DB_BYTES || undefined);
    globalThis.__DEMO_DB = this.db;
  }

  exec(sql) {
    this.db.exec(sql);
    dirty();
  }

  prepare(sql) {
    const db = this.db;
    const withStmt = (fn) => (...params) => {
      const st = db.prepare(sql);
      try {
        if (params.length) st.bind(params.map((v) => (v === undefined ? null : v)));
        return fn(st);
      } finally {
        st.free();
      }
    };
    return {
      get: withStmt((st) => (st.step() ? st.getAsObject() : undefined)),
      all: withStmt((st) => {
        const rows = [];
        while (st.step()) rows.push(st.getAsObject());
        return rows;
      }),
      run: withStmt((st) => {
        st.step();
        const changes = db.getRowsModified();
        const lastInsertRowid = db.exec('SELECT last_insert_rowid()')[0].values[0][0];
        dirty();
        return { changes, lastInsertRowid };
      }),
    };
  }
}
