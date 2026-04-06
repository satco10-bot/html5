import { canvasToBlob, guessExtensionFromMime, readBlobAsDataUrl, sanitizeFilename } from '../utils.js';

const DB_NAME = 'detail-page-editor-runtime-assets';
const DB_VERSION = 1;
const STORE_NAME = 'assets';
const RUNTIME_ASSET_SCHEME = 'asset';
const PREVIEW_MAX_DIMENSION = 1800;

const runtimeAssetRecords = new Map();
let runtimeAssetDbPromise = null;

function buildRecordPreviewUrl(record) {
  const sourceBlob = record.previewBlob || record.originalBlob || null;
  if (!sourceBlob) return '';
  if (record.previewUrl) return record.previewUrl;
  record.previewUrl = URL.createObjectURL(sourceBlob);
  return record.previewUrl;
}

function stableAssetId() {
  if (globalThis.crypto?.randomUUID) return `asset_${globalThis.crypto.randomUUID().replaceAll('-', '')}`;
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeRecord(record) {
  if (!record) return null;
  const normalized = {
    id: String(record.id || stableAssetId()),
    name: sanitizeFilename(record.name || `asset${guessExtensionFromMime(record.type || '', '.bin')}`),
    type: String(record.type || record.originalBlob?.type || record.previewBlob?.type || ''),
    projectKey: String(record.projectKey || ''),
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
    size: Number(record.size || record.originalBlob?.size || 0),
    originalBlob: record.originalBlob || null,
    previewBlob: record.previewBlob || null,
    width: Number(record.width || 0),
    height: Number(record.height || 0),
    previewWidth: Number(record.previewWidth || 0),
    previewHeight: Number(record.previewHeight || 0),
    previewUrl: record.previewUrl || '',
  };
  buildRecordPreviewUrl(normalized);
  runtimeAssetRecords.set(normalized.id, normalized);
  return normalized;
}

function openRuntimeAssetDb() {
  if (runtimeAssetDbPromise) return runtimeAssetDbPromise;
  if (typeof indexedDB === 'undefined') {
    runtimeAssetDbPromise = Promise.resolve(null);
    return runtimeAssetDbPromise;
  }
  runtimeAssetDbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return runtimeAssetDbPromise;
}

async function withStore(mode, callback) {
  const db = await openRuntimeAssetDb();
  if (!db) return null;
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = callback(store, tx);
      tx.oncomplete = () => resolve(result ?? null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putRuntimeAssetRecord(record) {
  await withStore('readwrite', (store) => {
    store.put({
      id: record.id,
      name: record.name,
      type: record.type,
      projectKey: record.projectKey,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      size: record.size,
      width: record.width,
      height: record.height,
      previewWidth: record.previewWidth,
      previewHeight: record.previewHeight,
      originalBlob: record.originalBlob,
      previewBlob: record.previewBlob,
    });
    return true;
  });
}

async function loadRuntimeAssetRecord(id) {
  if (!id) return null;
  if (runtimeAssetRecords.has(id)) return runtimeAssetRecords.get(id);
  const db = await openRuntimeAssetDb();
  if (!db) return null;
  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(id);
      request.onsuccess = () => resolve(normalizeRecord(request.result || null));
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function loadImageDimensions(blob) {
  if (!(blob instanceof Blob) || !String(blob.type || '').startsWith('image/')) return null;
  const url = URL.createObjectURL(blob);
  try {
    const dims = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || img.width || 0, height: img.naturalHeight || img.height || 0, img });
      img.onerror = () => resolve(null);
      img.src = url;
    });
    return dims;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function buildPreviewBlob(blob, { maxDimension = PREVIEW_MAX_DIMENSION } = {}) {
  if (!(blob instanceof Blob)) return { previewBlob: null, width: 0, height: 0, previewWidth: 0, previewHeight: 0 };
  const type = String(blob.type || '').toLowerCase();
  if (!type.startsWith('image/') || type.includes('svg')) {
    const dims = await loadImageDimensions(blob);
    return {
      previewBlob: blob,
      width: Number(dims?.width || 0),
      height: Number(dims?.height || 0),
      previewWidth: Number(dims?.width || 0),
      previewHeight: Number(dims?.height || 0),
    };
  }

  const dims = await loadImageDimensions(blob);
  const width = Number(dims?.width || 0);
  const height = Number(dims?.height || 0);
  const largest = Math.max(width, height);
  if (!largest || largest <= maxDimension) {
    return { previewBlob: blob, width, height, previewWidth: width, previewHeight: height };
  }
  const scale = maxDimension / largest;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  try {
    let bitmap = null;
    if (typeof createImageBitmap === 'function') {
      try { bitmap = await createImageBitmap(blob); } catch {}
    }
    if (!bitmap) return { previewBlob: blob, width, height, previewWidth: width, previewHeight: height };
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) {
      bitmap.close?.();
      return { previewBlob: blob, width, height, previewWidth: width, previewHeight: height };
    }
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
    bitmap.close?.();
    const outputType = type.includes('png') ? 'image/png' : type.includes('webp') ? 'image/webp' : 'image/jpeg';
    const previewBlob = await canvasToBlob(canvas, outputType, outputType === 'image/jpeg' ? 0.88 : undefined);
    return { previewBlob, width, height, previewWidth: targetWidth, previewHeight: targetHeight };
  } catch {
    return { previewBlob: blob, width, height, previewWidth: width, previewHeight: height };
  }
}

export function buildRuntimeAssetRef(id, name = '') {
  const assetId = String(id || '').trim();
  if (!assetId) return '';
  const safeName = sanitizeFilename(name || 'asset');
  return `${RUNTIME_ASSET_SCHEME}:${assetId}/${encodeURIComponent(safeName)}`;
}

export function parseRuntimeAssetRef(ref) {
  const match = String(ref || '').trim().match(/^asset:([A-Za-z0-9_-]+)(?:\/([^?#]+))?/i);
  if (!match) return null;
  return {
    id: match[1],
    name: match[2] ? decodeURIComponent(match[2]) : '',
  };
}

export function collectRuntimeAssetIdsFromHtml(html = '') {
  const ids = new Set();
  const source = String(html || '');
  const re = /asset:([A-Za-z0-9_-]+)/g;
  let match = re.exec(source);
  while (match) {
    ids.add(match[1]);
    match = re.exec(source);
  }
  return Array.from(ids);
}

export function resolveRuntimeAssetPreviewUrl(ref) {
  const parsed = parseRuntimeAssetRef(ref);
  if (!parsed) return '';
  const record = runtimeAssetRecords.get(parsed.id);
  if (!record) return '';
  return buildRecordPreviewUrl(record) || '';
}

export function getRuntimeAssetRecord(id) {
  return id ? runtimeAssetRecords.get(String(id)) || null : null;
}

export async function ensureRuntimeAssetRecords(ids = []) {
  const uniqueIds = Array.from(new Set(Array.from(ids || []).map((id) => String(id || '').trim()).filter(Boolean)));
  const loaded = [];
  for (const id of uniqueIds) {
    // eslint-disable-next-line no-await-in-loop
    const record = await loadRuntimeAssetRecord(id);
    if (record) loaded.push(record);
  }
  return loaded;
}

export async function registerRuntimeAsset(file, { projectKey = '', maxDimension = PREVIEW_MAX_DIMENSION } = {}) {
  const originalBlob = file instanceof Blob ? file : null;
  if (!originalBlob) throw new Error('런타임 자산으로 등록할 파일이 필요합니다.');
  const name = sanitizeFilename(file.name || `asset${guessExtensionFromMime(originalBlob.type || '', '.bin')}`);
  const id = stableAssetId();
  const preview = await buildPreviewBlob(originalBlob, { maxDimension });
  const record = normalizeRecord({
    id,
    name,
    type: originalBlob.type || '',
    projectKey,
    size: originalBlob.size,
    originalBlob,
    previewBlob: preview.previewBlob || originalBlob,
    width: preview.width,
    height: preview.height,
    previewWidth: preview.previewWidth,
    previewHeight: preview.previewHeight,
  });
  void putRuntimeAssetRecord(record);
  return record;
}

export async function runtimeAssetRefToDataUrl(ref) {
  const parsed = parseRuntimeAssetRef(ref);
  if (!parsed) return String(ref || '').trim();
  const record = await loadRuntimeAssetRecord(parsed.id);
  if (!record?.originalBlob) return String(ref || '').trim();
  return await readBlobAsDataUrl(record.originalBlob);
}

export async function materializeRuntimeAssetRef(ref, { pathMap = null, assetEntries = null, hint = 'asset' } = {}) {
  const parsed = parseRuntimeAssetRef(ref);
  if (!parsed) return String(ref || '').trim();
  const record = await loadRuntimeAssetRecord(parsed.id);
  if (!record?.originalBlob || !assetEntries || !pathMap) return String(ref || '').trim();
  if (pathMap.has(parsed.id)) return pathMap.get(parsed.id);
  const bytes = new Uint8Array(await record.originalBlob.arrayBuffer());
  const ext = /\.[a-z0-9]+$/i.test(record.name || '')
    ? record.name.slice(record.name.lastIndexOf('.'))
    : guessExtensionFromMime(record.type || record.originalBlob.type || '', '.bin');
  const base = sanitizeFilename((record.name || hint || 'asset').replace(/\.[a-z0-9]+$/i, '') || 'asset');
  const name = `assets/${String(assetEntries.length + 1).padStart(3, '0')}_${base}${ext}`;
  assetEntries.push({ name, data: bytes });
  pathMap.set(parsed.id, name);
  return name;
}
