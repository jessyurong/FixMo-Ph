/**
 * Storage Folder React context.
 *
 * Exposes the connected-folder state (name, permission, persistence) plus the
 * user actions (choose / disconnect / re-grant) so any page can reflect the
 * current status. This is UI state only — the actual folder writes delegate to
 * the storage-folder module, which IndexedDB-backed code paths can use without
 * touching React.
 */

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  chooseStorageFolder,
  disconnectStorageFolder,
  getStoredFolderInfo,
  isStorageFolderSupported,
  loadPersistedHandle,
  requestStorageFolderPermission,
  type StorageFolderInfo,
  type StorageFolderPermission,
} from './storage-folder';

interface StorageFolderState {
  /** Whether the File System Access API is available on this browser. */
  supported: boolean;
  /** Initial status load in progress. */
  loading: boolean;
  /** Folder picker is open / being set up. */
  choosing: boolean;
  folder: StorageFolderInfo | null;
  error: string | null;
  chooseFolder: () => Promise<StorageFolderInfo | null>;
  disconnect: () => Promise<void>;
  /** Re-ask for read-write permission (a user gesture is required). */
  grantPermission: () => Promise<StorageFolderPermission>;
  refreshStatus: () => Promise<void>;
}

const StorageFolderContext = createContext<StorageFolderState | null>(null);

export function StorageFolderProvider({ children }: { children: ReactNode }) {
  const supported = isStorageFolderSupported();
  const [loading, setLoading] = useState(supported);
  const [choosing, setChoosing] = useState(false);
  const [folder, setFolder] = useState<StorageFolderInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!supported) {
      setLoading(false);
      return;
    }
    try {
      const info = await getStoredFolderInfo();
      setFolder(info);
      setError(null);
    } catch (err) {
      console.error('Failed to load storage folder status:', err);
      setError(err instanceof Error ? err.message : 'Could not read the storage folder status.');
      setFolder(null);
    } finally {
      setLoading(false);
    }
  }, [supported]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const chooseFolder = useCallback(async (): Promise<StorageFolderInfo | null> => {
    if (!supported) return null;
    setChoosing(true);
    setError(null);
    try {
      const info = await chooseStorageFolder();
      if (info) setFolder(info);
      return info;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not connect a storage folder.';
      setError(message);
      throw err;
    } finally {
      setChoosing(false);
    }
  }, [supported]);

  const disconnect = useCallback(async () => {
    try {
      await disconnectStorageFolder();
      setFolder(null);
      setError(null);
    } catch (err) {
      console.error('Failed to disconnect storage folder:', err);
      setError(err instanceof Error ? err.message : 'Could not disconnect the storage folder.');
      throw err;
    }
  }, []);

  const grantPermission = useCallback(async (): Promise<StorageFolderPermission> => {
    const entry = await loadPersistedHandle();
    if (!entry) {
      setError('No storage folder is connected.');
      return 'denied';
    }
    const permission = await requestStorageFolderPermission(entry.handle);
    setFolder((current) => (current ? { ...current, permission } : current));
    if (permission !== 'granted') {
      setError(
        permission === 'denied'
          ? 'Access to the storage folder was denied by the browser.'
          : 'Access to the storage folder is still pending.',
      );
    } else {
      setError(null);
    }
    return permission;
  }, []);

  return (
    <StorageFolderContext.Provider
      value={{ supported, loading, choosing, folder, error, chooseFolder, disconnect, grantPermission, refreshStatus }}
    >
      {children}
    </StorageFolderContext.Provider>
  );
}

export function useStorageFolder(): StorageFolderState {
  const ctx = useContext(StorageFolderContext);
  if (!ctx) throw new Error('useStorageFolder must be used inside StorageFolderProvider');
  return ctx;
}