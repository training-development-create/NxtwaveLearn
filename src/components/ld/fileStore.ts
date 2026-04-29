// Tiny IndexedDB key/value store for File blobs that can't fit in localStorage.
// Used by AdminUpload to keep the picked video / agreement / reading-material
// files alive across tab switches and page reloads while a draft is in progress.

const DB_NAME = 'admin-upload-files';
const STORE = 'files';
const VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putFile(key: string, file: File | null): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      if (file) store.put(file, key); else store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[fileStore] putFile failed for', key, err);
  }
}

export async function getFile(key: string): Promise<File | null> {
  try {
    const db = await openDB();
    const file = await new Promise<File | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        if (v instanceof File) resolve(v);
        else if (v instanceof Blob) {
          // Older entries may have been written as Blob — wrap as File.
          resolve(new File([v], key, { type: v.type }));
        } else resolve(null);
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
    return file;
  } catch (err) {
    console.warn('[fileStore] getFile failed for', key, err);
    return null;
  }
}

export async function clearFiles(prefix: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) { resolve(); return; }
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) {
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
    db.close();
  } catch (err) {
    console.warn('[fileStore] clearFiles failed for', prefix, err);
  }
}
