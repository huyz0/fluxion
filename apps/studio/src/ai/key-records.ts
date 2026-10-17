// Where keys rest (ADR-0041): one record per provider id in IndexedDB database `fluxion-ai`, store `keys`. Nothing is read from
// localStorage, cookies or the URL.

/** A key held as written. */
export type PlainKey = { readonly provider: string; readonly value: string };
/** A key sealed with a passphrase: AES-GCM-256 under a PBKDF2-SHA-256 key. */
export type SealedKey = {
  readonly provider: string;
  readonly iterations: number;
  readonly salt: Uint8Array;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
};
/** One stored key record. */
export type KeyRecord = PlainKey | SealedKey;

/** The storage under the key store; IndexedDB in the browser, memory in tests. */
export type KeyRecords = {
  get(provider: string): Promise<KeyRecord | undefined>;
  put(record: KeyRecord): Promise<void>;
  delete(provider: string): Promise<void>;
  clear(): Promise<void>;
  list(): Promise<readonly string[]>;
};

/** The name of the database. */
export const KEY_DB = 'fluxion-ai';
const STORE = 'keys';

/** Records kept in memory. */
export function memoryKeyRecords(): KeyRecords {
  const rows = new Map<string, KeyRecord>();
  return {
    get: (p) => Promise.resolve(rows.get(p)),
    put: (r) => {
      rows.set(r.provider, r);
      return Promise.resolve();
    },
    delete: (p) => {
      rows.delete(p);
      return Promise.resolve();
    },
    clear: () => {
      rows.clear();
      return Promise.resolve();
    },
    list: () => Promise.resolve([...rows.keys()]),
  };
}

const settled = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function openDb(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'provider' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Records in IndexedDB database `name` of `factory`. */
export function idbKeyRecords(factory: IDBFactory, name: string = KEY_DB): KeyRecords & { close(): void } {
  const opened = openDb(factory, name);
  const store = async (mode: IDBTransactionMode) => (await opened).transaction(STORE, mode).objectStore(STORE);
  return {
    get: async (p) => (await settled((await store('readonly')).get(p))) as KeyRecord | undefined,
    put: async (r) => void (await settled((await store('readwrite')).put(r))),
    delete: async (p) => void (await settled((await store('readwrite')).delete(p))),
    clear: async () => void (await settled((await store('readwrite')).clear())),
    list: async () => (await settled((await store('readonly')).getAllKeys())).map(String),
    close: () => void opened.then((db) => db.close()),
  };
}
