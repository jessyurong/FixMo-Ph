/**
 * Ambient declarations for the File System Access API members that the
 * installed TypeScript DOM library does not ship (a stripped lib.dom).
 *
 * These match the real Chromium API and are always runtime-gated by feature
 * detection in storage-folder.ts, so bundling them for every browser is safe.
 * The handle/stream types themselves (FileSystemDirectoryHandle,
 * FileSystemFileHandle, FileSystemWritableFileStream, ...) already exist in
 * lib.dom — only the permission methods and the window picker are missing.
 */

interface FileSystemHandlePermissionDescriptor {
  mode?: "read" | "readwrite";
}

type FileSystemPermissionMode = "read" | "readwrite";

interface FileSystemHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface Window {
  showDirectoryPicker(options?: {
    id?: string;
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | string;
  }): Promise<FileSystemDirectoryHandle>;
}