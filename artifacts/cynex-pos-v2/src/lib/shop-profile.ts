/**
 * Shop Profile
 *
 * Single source of truth for the shop identity used across the app (login,
 * sidebar, dashboard, receipts, printed reports, and the Settings page).
 *
 * Values are stored as key/value rows in the existing Dexie `settings` table,
 * so they survive refresh/restart (IndexedDB) and are included in backups
 * automatically because the `settings` table is part of the backup payload.
 */

// Settings table keys
export const SHOP_LOGO_KEY = 'shopLogo';
export const SHOP_EMAIL_KEY = 'shopEmail';
export const SHOP_DESCRIPTION_KEY = 'shopDescription';

// Existing settings keys reused by the Shop Profile section
export const SHOP_NAME_KEY = 'storeName';
export const SHOP_ADDRESS_KEY = 'storeAddress';
export const SHOP_CONTACT_KEY = 'contactNumber';

export const LOGO_MAX_DIMENSION = 512;
export const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export const LOGO_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'];
export const LOGO_ACCEPT_ATTR = 'image/png,image/jpeg,image/webp';

export const DEFAULT_SHOP_NAME = 'CYNEX TECHNOLOGY';

export interface ShopProfile {
  /** Data URL of the uploaded logo (PNG/JPG/WEBP). */
  logo?: string;
  name: string;
  address?: string;
  contactNumber?: string;
  email?: string;
  description?: string;
}

export function shopProfileFromSettings(settings?: Record<string, any> | null): ShopProfile {
  const s = settings || {};
  const str = (key: string) => (typeof s[key] === 'string' && s[key].trim() ? s[key].trim() : undefined);

  return {
    logo: str(SHOP_LOGO_KEY),
    name: str(SHOP_NAME_KEY) || DEFAULT_SHOP_NAME,
    address: str(SHOP_ADDRESS_KEY),
    contactNumber: str(SHOP_CONTACT_KEY),
    email: str(SHOP_EMAIL_KEY),
    description: str(SHOP_DESCRIPTION_KEY),
  };
}

/**
 * Validate a logo file before processing. Returns an error message or null.
 */
export function validateLogoFile(file: File): string | null {
  if (!LOGO_ACCEPT.includes(file.type)) {
    return 'Unsupported file type. Please choose a PNG, JPG, or WEBP image.';
  }
  if (file.size > LOGO_MAX_BYTES) {
    return 'Image is too large (max 5 MB).';
  }
  return null;
}

/**
 * Read a logo file and downscale it to a persistent data URL.
 * The result is stored (not a temporary object URL) so it survives refresh
 * and restart once written to IndexedDB.
 */
export function fileToResizedLogoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const invalid = validateLogoFile(file);
    if (invalid) {
      reject(new Error(invalid));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid or corrupted image file.'));
      img.onload = () => {
        try {
          const scale = Math.min(1, LOGO_MAX_DIMENSION / Math.max(img.width, img.height));
          const width = Math.max(1, Math.round(img.width * scale));
          const height = Math.max(1, Math.round(img.height * scale));

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Image processing is not supported in this browser.'));
            return;
          }

          ctx.drawImage(img, 0, 0, width, height);
          const mime = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
          resolve(canvas.toDataURL(mime, 0.85));
        } catch {
          reject(new Error('Failed to process the image.'));
        }
      };
      img.src = typeof reader.result === 'string' ? reader.result : '';
    };
    reader.readAsDataURL(file);
  });
}