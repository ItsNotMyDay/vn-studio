import { useEffect, useState } from 'react';

const DB = 'vn-studio-assets';
const STORE = 'blobs';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function getBlob(id: string): Promise<Blob | null> {
  const d = await db();
  return new Promise((res, rej) => {
    const rq = d.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    rq.onsuccess = () => res(rq.result ?? null);
    rq.onerror = () => rej(rq.error);
  });
}

export async function deleteBlob(id: string): Promise<void> {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

export async function getAssetURL(id: string): Promise<string | null> {
  if (urlCache.has(id)) return urlCache.get(id)!;
  if (pending.has(id)) return pending.get(id)!;
  const p = (async () => {
    const b = await getBlob(id);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urlCache.set(id, u);
    return u;
  })();
  pending.set(id, p);
  const r = await p;
  pending.delete(id);
  return r;
}

export function revokeAssetURL(id: string) {
  const u = urlCache.get(id);
  if (u) { URL.revokeObjectURL(u); urlCache.delete(id); }
}

export function useAssetURL(id?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(id ? urlCache.get(id) ?? null : null);
  useEffect(() => {
    let alive = true;
    if (!id) { setUrl(null); return; }
    const cached = urlCache.get(id);
    if (cached) { setUrl(cached); return; }
    getAssetURL(id).then(u => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [id]);
  return url;
}

export async function importFile(file: File, prefix: string): Promise<string> {
  const id = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await putBlob(id, file);
  return id;
}