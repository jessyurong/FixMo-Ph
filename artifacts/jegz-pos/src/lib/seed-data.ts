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

const SEED_FLAG = 'db_seeded_v1';

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

    console.log('Seeding initial demo data...');

    // Seed Products
    const demoProducts = [
      {
        name: 'iPhone 13 Screen',
        category: 'Parts',
        price: 150,
        cost: 80,
        stock: 20,
        reorderPoint: 5,
        sku: 'IPHONE13-SCREEN',
        deviceType: 'iPhone',
      },
      {
        name: 'iPhone 13 Battery',
        category: 'Parts',
        price: 60,
        cost: 25,
        stock: 30,
        reorderPoint: 10,
        sku: 'IPHONE13-BATTERY',
        deviceType: 'iPhone',
      },
      {
        name: 'Samsung Galaxy S21 Screen',
        category: 'Parts',
        price: 140,
        cost: 75,
        stock: 15,
        reorderPoint: 5,
        sku: 'SAMSUNG-S21-SCREEN',
        deviceType: 'Samsung',
      },
      {
        name: 'Samsung Galaxy S21 Battery',
        category: 'Parts',
        price: 55,
        cost: 20,
        stock: 25,
        reorderPoint: 10,
        sku: 'SAMSUNG-S21-BATTERY',
        deviceType: 'Samsung',
      },
      {
        name: 'USB-C Cable',
        category: 'Accessories',
        price: 15,
        cost: 5,
        stock: 100,
        reorderPoint: 20,
        sku: 'CABLE-USB-C',
      },
      {
        name: 'Phone Case (Universal)',
        category: 'Accessories',
        price: 20,
        cost: 8,
        stock: 50,
        reorderPoint: 10,
        sku: 'CASE-UNIVERSAL',
      },
      {
        name: 'Screen Protector',
        category: 'Accessories',
        price: 10,
        cost: 3,
        stock: 200,
        reorderPoint: 50,
        sku: 'PROTECTOR-SCREEN',
      },
    ];

    for (const product of demoProducts) {
      await productService.create(product);
    }

    // Seed Services
    const demoServices = [
      {
        name: 'Screen Replacement',
        type: 'repair',
        price: 80,
        cost: 50,
        duration: 30,
      },
      {
        name: 'Battery Replacement',
        type: 'repair',
        price: 40,
        cost: 20,
        duration: 15,
      },
      {
        name: 'Phone Cleaning',
        type: 'maintenance',
        price: 25,
        cost: 5,
        duration: 10,
      },
      {
        name: 'Software Troubleshooting',
        type: 'support',
        price: 50,
        cost: 10,
        duration: 45,
      },
      {
        name: 'Water Damage Assessment',
        type: 'diagnosis',
        price: 30,
        cost: 5,
        duration: 15,
      },
      {
        name: 'Charging Port Repair',
        type: 'repair',
        price: 60,
        cost: 30,
        duration: 30,
      },
    ];

    for (const service of demoServices) {
      await serviceService.create(service);
    }

    // Seed Technicians
    const demoTechnicians = [
      {
        name: 'Juan Santos',
        email: 'juan@jegz.local',
        phone: '09171234567',
        specialization: 'iPhone',
      },
      {
        name: 'Maria Cruz',
        email: 'maria@jegz.local',
        phone: '09171234568',
        specialization: 'Samsung',
      },
      {
        name: 'Carlos Reyes',
        email: 'carlos@jegz.local',
        phone: '09171234569',
        specialization: 'General',
      },
      {
        name: 'Ana Lopez',
        email: 'ana@jegz.local',
        phone: '09171234570',
        specialization: 'Water Damage',
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
