/**
 * Data Seeding Module
 * Initializes demo data on first run if database is empty
 */

import { localDb } from './local-db';
import {
  productService,
  serviceService,
  technicianService,
  settingsService,
  ensureJobNumbers,
  normalizeLowStockDefaults,
  normalizeServiceCatalog,
} from './offline-data-services';

const SEED_FLAG = 'db_seeded_cynex_v1';

export async function seedDatabaseIfNeeded() {
  try {
    // Check if already seeded
    const meta = await localDb.meta.get(SEED_FLAG);
    if (meta && meta.value === true) {
      return; // Already seeded
    }

    // Count existing data to avoid overwriting
    const productCount = await localDb.products.count();
    const serviceCount = await localDb.services.count();

    if (productCount > 0 || serviceCount > 0) {
      // Data exists but seed flag not set - mark as seeded to avoid re-seeding
      await localDb.meta.put({
        key: SEED_FLAG,
        value: true,
      } as any);
      return;
    }

    console.log('Seeding Cynex technician demo data...');

    // Seed default branch + shop profile (per-branch isolation)
    try {
      await settingsService.set('currentBranch', 'BRANCH_1');
      await settingsService.set('storeName', 'CYNEX TECHNOLOGY');
    } catch { /* ignore */ }

    // Seed Products — parts-used list for technicians (not full retail catalog)
    const demoProducts = [
      {
        name: '8GB DDR4 Laptop RAM',
        category: 'PC Parts',
        price: 1800,
        cost: 1300,
        stock: 20,
        reorderPoint: 5,
        sku: 'CYNEX-RAM-8GB-D4',
        deviceType: 'Laptop',
        brand: 'Generic',
      },
      {
        name: '512GB SATA SSD',
        category: 'PC Parts',
        price: 2800,
        cost: 2100,
        stock: 15,
        reorderPoint: 4,
        sku: 'CYNEX-SSD-512',
        deviceType: 'Laptop/Desktop',
        brand: 'Generic',
      },
      {
        name: 'Epson 664 Black Ink',
        category: 'Inks',
        price: 450,
        cost: 300,
        stock: 40,
        reorderPoint: 10,
        sku: 'CYNEX-INK-664BK',
        deviceType: 'Printer',
        brand: 'Epson',
        compatibility: 'L360/L380/L565',
      },
      {
        name: 'Cat6 UTP Cable (per meter)',
        category: 'Networking',
        price: 35,
        cost: 18,
        stock: 300,
        reorderPoint: 100,
        sku: 'CYNEX-CAT6-M',
        deviceType: 'Network',
      },
      {
        name: 'Hikvision 2MP Bullet CCTV',
        category: 'CCTV',
        price: 1500,
        cost: 1050,
        stock: 12,
        reorderPoint: 4,
        sku: 'CYNEX-CCTV-2MP',
        deviceType: 'CCTV',
        brand: 'Hikvision',
      },
      {
        name: '24" Monitor (Generic)',
        category: 'Monitor',
        price: 6500,
        cost: 5200,
        stock: 8,
        reorderPoint: 2,
        sku: 'CYNEX-MON-24',
        deviceType: 'Desktop',
      },
      {
        name: 'Thermal Paste + Cleaning Kit',
        category: 'Consumables',
        price: 250,
        cost: 80,
        stock: 50,
        reorderPoint: 10,
        sku: 'CYNEX-THERMAL-KIT',
      },
    ];

    for (const product of demoProducts) {
      await productService.create(product);
    }

    // Seed Services — technician service catalog (per-branch labor)
    const demoServices = [
      {
        name: 'Laptop General Cleaning + Repaste',
        type: 'laptop_repair',
        price: 800,
        cost: 100,
        duration: 60,
        category: 'Laptop Repair',
      },
      {
        name: 'Laptop No Power Diagnosis',
        type: 'diagnosis',
        price: 300,
        cost: 0,
        duration: 30,
        category: 'Diagnosis',
      },
      {
        name: 'OS + Drivers Reformat',
        type: 'software',
        price: 500,
        cost: 0,
        duration: 90,
        category: 'Software',
      },
      {
        name: 'CCTV Installation (per camera)',
        type: 'cctv_install',
        price: 1200,
        cost: 200,
        duration: 120,
        category: 'CCTV',
      },
      {
        name: 'Network Setup / Router Config',
        type: 'network_setup',
        price: 1000,
        cost: 100,
        duration: 90,
        category: 'Networking',
      },
      {
        name: 'Printer Head Cleaning / Service',
        type: 'printer_service',
        price: 600,
        cost: 50,
        duration: 45,
        category: 'Printer Service',
      },
    ];

    for (const service of demoServices) {
      await serviceService.create(service);
    }

    // Seed Technicians
    const demoTechnicians = [
      {
        name: 'Cynex Tech B1',
        email: 'tech-b1@cynex.local',
        phone: '09170000001',
        specialization: 'Laptop / PC',
      },
      {
        name: 'Cynex Tech B2',
        email: 'tech-b2@cynex.local',
        phone: '09170000002',
        specialization: 'CCTV / Network',
      },
      {
        name: 'Printer Tech',
        email: 'printer@cynex.local',
        phone: '09170000003',
        specialization: 'Printer',
      },
    ];

    for (const tech of demoTechnicians) {
      await technicianService.create(tech);
    }

    // Mark as seeded
    await localDb.meta.put({
      key: SEED_FLAG,
      value: true,
    } as any);

    console.log('✓ Demo data seeded successfully');
  } catch (error) {
    console.error('Error seeding database:', error);
  }

  // Backfill job numbers for any pre-existing transactions (idempotent).
  try {
    await ensureJobNumbers();
  } catch (error) {
    console.error('Error backfilling job numbers:', error);
  }

  // Backfill the default low-stock threshold for products without one (idempotent).
  try {
    await normalizeLowStockDefaults();
  } catch (error) {
    console.error('Error backfilling low-stock defaults:', error);
  }

  // Normalize the service catalog (category/active/cost) for any pre-existing
  // or legacy services so POS and Services & Labor always agree (idempotent).
  try {
    await normalizeServiceCatalog();
  } catch (error) {
    console.error('Error normalizing service catalog:', error);
  }
}

export async function resetDatabase() {
  try {
    console.log('Resetting database...');
    const tables = [
      'products',
      'services',
      'technicians',
      'transactions',
      'transactionItems',
      'cashDrawerEntries',
      'gcashDrawerEntries',
      'defectiveItems',
      'backjobs',
      'users',
      'settings',
      'meta',
    ];

    for (const table of tables) {
      await (localDb as any)[table].clear();
    }

    console.log('✓ Database reset successfully');
  } catch (error) {
    console.error('Error resetting database:', error);
  }
}
