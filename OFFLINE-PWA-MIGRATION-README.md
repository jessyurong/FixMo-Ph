# JEGZ POS — Offline PWA Migration Package

This package contains the original JEGZ POS workspace plus the foundation for the agreed architecture:

- React + Vite
- PWA installability and offline app shell
- IndexedDB through Dexie
- JSON export backup
- JSON restore/import
- 7-day backup due checker
- GitHub -> Vercel deployment path

## Important current status

The offline database and backup foundation is ready, but the original React pages still call the existing `/api/*` backend. The full production migration requires replacing those API calls with the IndexedDB data layer. Do **not** delete the original API/database code until all pages have been migrated and tested.

This is therefore a migration-ready project package, not yet a finished production POS build.

## Next development step

Install dependencies with pnpm, then migrate feature-by-feature in this order:
1. Products
2. Services
3. Technicians
4. Transactions / POS checkout
5. Inventory updates and drawer entries
6. Defective items and backjobs
7. Dashboard and reports
8. Settings, users, and local authentication

## Backup API included

`src/lib/backup.ts` exports:
- `downloadBackup()`
- `restoreBackup(file, 'replace' | 'merge')`
- `isBackupDue(7)`

## Run

From the workspace root:

```bash
pnpm install
pnpm --filter @workspace/jegz-pos dev
```

## Deploy

Build after the API migration is complete, then connect the GitHub repository to Vercel with the frontend package as the project root.
