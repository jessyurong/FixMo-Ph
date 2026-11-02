/**
 * Storage Folder (File System Access API)
 *
 * Lets the user connect a dedicated local folder (e.g. "JEGZ POS") where the
 * app can write backups and future receipts/job slips/reports/exports.
 *
 * Design rules:
 * - No backend, server, Electron or cloud storage. Files are written ONLY
 *   through the handle the user explicitly picked. We never guess a path.
 * - IndexedDB stays the source of truth for POS data. Only the directory
 *   HANDLE (a small structured-cloneable reference) is persisted in the
 *   existing origin-scoped `meta` table so permission can be re-asked after
 *   reloads. The handle is origin-scoped, so it can never be read by another
 *   site or silently resolved to a path outside the picked folder.
 * - Unsupported browsers degrade to the normal browser download flow.
 */

import { localDb } from './local-db';

/** meta table key that stores the persisted {@link PersistedStorageFolder}. */
export const STORAGE_FOLDER_HANDLE_KEY = 'posStorageFolderHandle_v1';

/** Standard subfolders created inside the user-picked folder. */
export const STORAGE_FOLDER_SUBFOLDERS = ['Backups', 'Receipts', 'Job Slips', 'Reports', 'Exports'] as const;
export type StorageSubfolder = (typeof STORAGE_FOLDER_SUBFOLDERS)[number];

export type StorageFolderPermission = 'granted' | 'prompt' | 'denied';

/** Public, serializable summary of the connected folder. */
export interface StorageFolderInfo {
  name: string;
  connectedAt: string;
  /** Current read-write permission state on the persisted handle. */
  permission: StorageFolderPermission;
  /** Whether the handle could be stored for later sessions. */
  persisted: boolean;
}

/** Result of successfully writing a file into the connected folder. */
export interface StorageFolderWriteResult {
  folderName: string;
  subfolder: StorageSubfolder;
  fileName: string;
}

/** Shape of the single meta row that persists the connection. */
interface PersistedStorageFolder {
  handle: FileSystemDirectoryHandle;
  name: string;
  connectedAt: string;
}

/**
 * True when the current browser exposes the File System Access API in a secure
 * context. Feature detection drives progressive enhancement everywhere else.
 */
export function isStorageFolderSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showDirectoryPicker === 'function' &&
    typeof FileSystemDirectoryHandle !== 'undefined'
  );
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return isStorageFolderSupported() && value instanceof FileSystemDirectoryHandle;
}

/** Read the current read-write permission state without prompting. */
export async function queryStorageFolderPermission(handle: FileSystemDirectoryHandle): Promise<StorageFolderPermission> {
  if (typeof handle.queryPermission !== 'function') return 'denied';
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) as StorageFolderPermission;
  } catch (error) {
    console.error('Failed to query storage folder permission:', error);
    return 'denied';
  }
}

/** Ask the user for read-write access. Must run from a user gesture. */
export async function requestStorageFolderPermission(
  handle: FileSystemDirectoryHandle,
): Promise<StorageFolderPermission> {
  if (typeof handle.requestPermission !== 'function') return 'denied';
  try {
    return (await handle.requestPermission({ mode: 'readwrite' })) as StorageFolderPermission;
  } catch (error) {
    console.error('Failed to request storage folder permission:', error);
    return 'denied';
  }
}

/** Ensure the standard feature subfolders exist inside the picked folder. */
async function ensureFeatureSubfolders(handle: FileSystemDirectoryHandle): Promise<void> {
  for (const name of STORAGE_FOLDER_SUBFOLDERS) {
    await handle.getDirectoryHandle(name, { create: true });
  }
}

async function persistFolder(entry: PersistedStorageFolder): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    await localDb.meta.put({
      key: STORAGE_FOLDER_HANDLE_KEY,
      value: entry,
      createdAt: now,
      updatedAt: now,
    });
    return true;
  } catch (error) {
    console.error('Failed to persist storage folder handle:', error);
    return false;
  }
}

/**
 * Load the persisted directory handle (if any). Returns null when nothing was
 * connected, or the stored value is no longer a usable directory handle.
 */
export async function loadPersistedHandle(): Promise<PersistedStorageFolder | null> {
  try {
    const row = await localDb.meta.get(STORAGE_FOLDER_HANDLE_KEY);
    const value = row?.value;
    if (value && typeof value === 'object' && 'handle' in value) {
      const candidate = value as Partial<PersistedStorageFolder>;
      if (isDirectoryHandle(candidate.handle)) {
        return candidate as PersistedStorageFolder;
      }
      await localDb.meta.delete(STORAGE_FOLDER_HANDLE_KEY);
    }
  } catch (error) {
    console.error('Failed to load storage folder handle:', error);
  }
  return null;
}

/** Load the persisted connected-folder summary, if any and still readable. */
export async function getStoredFolderInfo(): Promise<StorageFolderInfo | null> {
  const entry = await loadPersistedHandle();
  if (!entry) return null;
  const permission = await queryStorageFolderPermission(entry.handle);
  return {
    name: entry.name,
    connectedAt: entry.connectedAt,
    permission,
    persisted: true,
  };
}

/**
 * Open the platform folder picker so the user can select their dedicated
 * JEGZ POS folder. Creates the standard subfolders and persists the handle.
 *
 * Returns null when the user simply cancels the picker. Any real failure is
 * thrown so the UI can surface a clear error.
 */
export async function chooseStorageFolder(): Promise<StorageFolderInfo | null> {
  if (!isStorageFolderSupported()) {
    throw new Error('This browser does not support choosing a storage folder.');
  }

  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: 'jegz-pos-storage', mode: 'readwrite' });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return null;
    throw error;
  }

  await ensureFeatureSubfolders(handle);

  let permission = await requestStorageFolderPermission(handle);
  if (permission !== 'granted') permission = await queryStorageFolderPermission(handle);

  const entry: PersistedStorageFolder = {
    handle,
    name: handle.name || 'Selected folder',
    connectedAt: new Date().toISOString(),
  };
  const persisted = await persistFolder(entry);

  return {
    name: entry.name,
    connectedAt: entry.connectedAt,
    permission,
    persisted,
  };
}

/** Remove the persisted handle. Files already written are left untouched. */
export async function disconnectStorageFolder(): Promise<void> {
  await localDb.meta.delete(STORAGE_FOLDER_HANDLE_KEY);
}

/**
 * Write a blob into a subfolder of the connected folder.
 *
 * Returns null when there is no connected folder or read-write access was not
 * granted — in that case callers should fall back to a normal browser
 * download. Throws when the write itself failed so callers can surface the
 * error instead of silently losing data.
 */
export async function writeFileToStorageFolder(
  fileName: string,
  blob: Blob,
  subfolder: StorageSubfolder = 'Backups',
): Promise<StorageFolderWriteResult | null> {
  const entry = await loadPersistedHandle();
  if (!entry) return null; // No connected folder → caller falls back to download.

  let permission = await queryStorageFolderPermission(entry.handle);
  if (permission === 'prompt') permission = await requestStorageFolderPermission(entry.handle);
  if (permission !== 'granted') return null;

  const dir = await entry.handle.getDirectoryHandle(subfolder, { create: true });
  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(blob);
    await writable.close();
  } catch (error) {
    try {
      await writable.close();
    } catch {
      // Keep the original write error.
    }
    throw error;
  }

  return { folderName: entry.name, subfolder, fileName };
}