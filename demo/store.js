// Speicher fürs Browser-Demo: IndexedDB für Datenbank-Datei und hochgeladene Bilder
const DB_NAME = 'jfc-demo';
let idb;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('kv');
      req.result.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = idb.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function initStore() { idb = await open(); }
export const kvGet = (key) => tx('kv', 'readonly', (s) => s.get(key));
export const kvSet = (key, value) => tx('kv', 'readwrite', (s) => s.put(value, key));

// Hochgeladene Bilder: Dateiname → Blob (im Speicher + IndexedDB)
export const files = {
  map: new Map(),
  urls: new Map(),
  async loadAll() {
    const [keys, values] = await Promise.all([
      tx('files', 'readonly', (s) => s.getAllKeys()),
      tx('files', 'readonly', (s) => s.getAll()),
    ]);
    keys.forEach((k, i) => this.map.set(k, values[i]));
  },
  put(name, blob) {
    this.map.set(name, blob);
    tx('files', 'readwrite', (s) => s.put(blob, name)).catch((e) => console.error('Bild speichern', e));
  },
  remove(name) {
    this.map.delete(name);
    const url = this.urls.get(name);
    if (url) URL.revokeObjectURL(url);
    this.urls.delete(name);
    tx('files', 'readwrite', (s) => s.delete(name)).catch(() => {});
  },
  url(name) {
    if (!this.urls.has(name) && this.map.has(name)) this.urls.set(name, URL.createObjectURL(this.map.get(name)));
    return this.urls.get(name) || '';
  },
};

// Alle gespeicherten Demo-Daten leeren (Datenbank + Bilder)
export async function clearAll() {
  await tx('kv', 'readwrite', (s) => s.clear());
  await tx('files', 'readwrite', (s) => s.clear());
  files.urls.forEach((u) => URL.revokeObjectURL(u));
  files.urls.clear();
  files.map.clear();
}

export async function wipe() {
  idb?.close();
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}
