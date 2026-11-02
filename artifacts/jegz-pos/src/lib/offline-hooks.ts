/**
 * Offline-First React Hooks
 * These replace the API-based react-query hooks with local IndexedDB queries
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { UseQueryResult, UseMutationResult } from '@tanstack/react-query';
import bcrypt from 'bcryptjs';
import { localDb } from './local-db';
import {
  activityService,
  productService,
  serviceService,
  technicianService,
  transactionService,
  transactionItemService,
  customerService,
  defectiveItemService,
  backjobService,
  cashDrawerService,
  gcashDrawerService,
  settingsService,
  dashboardService,
  jobService,
  ensureJobNumbers,
  getCustomerNameSuggestions,
  getPhoneModelSuggestions,
  normalizeLowStockDefaults,
  normalizeServiceCatalog,
  isCompletedStatus,
  isOpenStatus,
  type EnrichedTransaction,
  type ActivityLog,
  type JobCompletionResult,
  type JobInput,
  type Product,
  type RepairStatus,
  type Service,
  type Technician,
  type Transaction,
  type TransactionItem,
  type TransactionStatus,
  type DefectiveItem,
  type Backjob,
  type Dashboard,
  type Settings,
  type TransactionStats,
  type MonthlyReport,
  type TechnicianReportRow,
  type CustomerSummary,
} from './offline-data-services';
import { shopProfileFromSettings, type ShopProfile } from './shop-profile';
import { getLastBackupTime } from './backup-restore';

// ─── Shared invalidation keys ───────────────────────────────────────────────
function useInvalidateBusinessData() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['transactions'] });
    queryClient.invalidateQueries({ queryKey: ['transactionStats'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['cashDrawer'] });
    queryClient.invalidateQueries({ queryKey: ['gcashDrawer'] });
    queryClient.invalidateQueries({ queryKey: ['technicians'] });
    queryClient.invalidateQueries({ queryKey: ['monthlyReport'] });
    queryClient.invalidateQueries({ queryKey: ['technicianReport'] });
    queryClient.invalidateQueries({ queryKey: ['customerNameSuggestions'] });
    queryClient.invalidateQueries({ queryKey: ['phoneModelSuggestions'] });
    queryClient.invalidateQueries({ queryKey: ['activityLogs'] });
  }, [queryClient]);
}

// Product Hooks
export function useListProducts(
  params?: { search?: string; deviceType?: string },
): UseQueryResult<Product[], unknown> {
  const search = params?.search || '';
  const deviceType = params?.deviceType || 'all';
  return useQuery({
    queryKey: ['products', search, deviceType],
    queryFn: () => productService.list({ search, deviceType }),
    staleTime: Infinity,
  });
}

export function useGetProduct(id: number | undefined): UseQueryResult<Product | undefined, unknown> {
  return useQuery({
    queryKey: ['product', id],
    queryFn: () => (id ? productService.get(id) : undefined),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCreateProduct(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => productService.create(data?.data || data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useUpdateProduct(): UseMutationResult<void, unknown, { id: number; data: Partial<Product> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => productService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

export function useDeleteProduct(): UseMutationResult<void, unknown, { id: number }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => productService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

// Service Hooks
export function useListServices(
  _params?: any,
): UseQueryResult<Service[], unknown> {
  return useQuery({
    queryKey: ['services'],
    queryFn: () => serviceService.list(),
    staleTime: Infinity,
  });
}

export function useGetService(id: number | undefined): UseQueryResult<Service | undefined, unknown> {
  return useQuery({
    queryKey: ['service', id],
    queryFn: () => (id ? serviceService.get(id) : undefined),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCreateService(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => serviceService.create(data?.data || data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useUpdateService(): UseMutationResult<void, unknown, { id: number; data: Partial<Service> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => serviceService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useDeleteService(): UseMutationResult<void, unknown, { id: number }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => serviceService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

// Technician Hooks
export function useListTechnicians(
  _params?: any,
): UseQueryResult<Technician[], unknown> {
  return useQuery({
    queryKey: ['technicians'],
    queryFn: () => technicianService.list(),
    staleTime: Infinity,
  });
}

export function useGetTechnician(id: number | undefined): UseQueryResult<Technician | undefined, unknown> {
  return useQuery({
    queryKey: ['technician', id],
    queryFn: () => (id ? technicianService.get(id) : undefined),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCreateTechnician(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => technicianService.create(data?.data || data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['technicians'] });
    },
  });
}

export function useUpdateTechnician(): UseMutationResult<void, unknown, { id: number; data: Partial<Technician> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => technicianService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['technicians'] });
    },
  });
}

export function useDeleteTechnician(): UseMutationResult<void, unknown, { id: number }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => technicianService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['technicians'] });
    },
  });
}

// Transaction Hooks
export type TransactionListParams = {
  period?: string;
  search?: string;
  status?: string;
};

export function useListTransactions(
  params?: TransactionListParams,
): UseQueryResult<EnrichedTransaction[], unknown> {
  return useQuery({
    queryKey: ['transactions', params?.period, params?.search, params?.status],
    queryFn: () =>
      transactionService.list({
        period: ['today', 'week', 'month', 'all'].includes(params?.period || '') ? (params?.period as any) : undefined,
        search: params?.search,
        status: params?.status,
      }),
    staleTime: Infinity,
  });
}

export function useGetTransaction(id: number | undefined): UseQueryResult<EnrichedTransaction | undefined, unknown> {
  return useQuery({
    queryKey: ['transaction', id],
    queryFn: () => (id ? transactionService.getEnriched(id) : undefined),
    enabled: !!id,
    staleTime: Infinity,
  });
}

/** Un-enriched record — used by the POS when opening a pending job. */
export function useGetTransactionRaw(id: number | undefined): UseQueryResult<Transaction | undefined, unknown> {
  return useQuery({
    queryKey: ['transactionRaw', id],
    queryFn: () => (id ? transactionService.get(id) : undefined),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useGetTransactionItems(id: number | undefined): UseQueryResult<TransactionItem[], unknown> {
  return useQuery({
    queryKey: ['transactionItems', id],
    queryFn: () => (id ? transactionItemService.getByTransactionId(id) : []),
    enabled: !!id,
    staleTime: Infinity,
  });
}

// Customer History Hooks
export function useListCustomers(params?: { search?: string }): UseQueryResult<CustomerSummary[], unknown> {
  return useQuery({
    queryKey: ['customers', params?.search || ''],
    queryFn: () => customerService.list(params?.search),
    staleTime: Infinity,
  });
}

export function useGetCustomerHistory(customerKey: string | null): UseQueryResult<EnrichedTransaction[], unknown> {
  return useQuery({
    queryKey: ['customerHistory', customerKey],
    queryFn: () => (customerKey ? customerService.history(customerKey) : Promise.resolve([] as EnrichedTransaction[])),
    enabled: !!customerKey,
    staleTime: Infinity,
  });
}

// POS checkout autocomplete (text suggestions from recent jobs)
export function useCustomerNameSuggestions(limit = 30): UseQueryResult<string[], unknown> {
  return useQuery({
    queryKey: ['customerNameSuggestions', limit],
    queryFn: () => getCustomerNameSuggestions(limit),
    staleTime: Infinity,
  });
}

export function usePhoneModelSuggestions(limit = 30): UseQueryResult<string[], unknown> {
  return useQuery({
    queryKey: ['phoneModelSuggestions', limit],
    queryFn: () => getPhoneModelSuggestions(limit),
    staleTime: Infinity,
  });
}

// Backup / Restore Hooks
export const LAST_BACKUP_QUERY_KEY = ['lastBackupTime'];

export function useGetLastBackupTime(): UseQueryResult<string | null, unknown> {
  return useQuery({
    queryKey: LAST_BACKUP_QUERY_KEY,
    queryFn: () => getLastBackupTime(),
    staleTime: Infinity,
  });
}

/** Legacy direct-complete hook kept for compatibility; routes through the full job flow. */
export function useCreateTransaction(): UseMutationResult<number, unknown, any> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async (data: any) => {
      const items = data.items || [];
      const result = await jobService.completeNewJob({
        customerName: data.customerName || 'Walk-in',
        customerPhone: data.customerPhone,
        paymentMethod: data.paymentMethod || 'cash',
        notes: data.notes,
        items: items.map((item: any) => ({
          type: item.type as 'product' | 'service',
          refId: Number(item.refId ?? item.id) || 0,
          name: item.name,
          quantity: item.quantity || 1,
          price: item.price || 0,
          subtotal: (item.quantity || 1) * (item.price || 0),
        })),
        total: data.total || 0,
      });
      return result.id;
    },
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTransaction(): UseMutationResult<void, unknown, { id: number; data: Partial<Transaction> }> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: ({ id, data }) => transactionService.update(id, data),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateTransactionStatus(): UseMutationResult<void, unknown, { id: number; status?: string; data?: { status: string; paymentMethod?: string; cashReceived?: number } }> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async ({ id, status, data }) => {
      const newStatus = (data?.status || status) as TransactionStatus;
      await jobService.updateJobStatus(id, newStatus);
      void activityService.log('transaction.status', `Job #${id} marked as ${newStatus}`, {
        entityType: 'transaction', entityId: id,
      });
    },
    onSuccess: () => invalidate(),
  });
}

export function useUpdateRepairStatus(): UseMutationResult<
  void,
  unknown,
  { id: number; repairStatus: RepairStatus }
> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async ({ id, repairStatus }) => {
      await jobService.updateRepairStatus(id, repairStatus);
      void activityService.log('transaction.status', `Job #${id} repair progress → ${repairStatus}`, {
        entityType: 'transaction', entityId: id,
      });
    },
    onSuccess: () => invalidate(),
  });
}

export function useDeleteTransaction(): UseMutationResult<void, unknown, { id: number }> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async ({ id }) => {
      const tx = await transactionService.get(id);
      const items = await transactionItemService.getByTransactionId(id);
      if (tx && isOpenStatus(tx.status)) {
        // Open jobs hold reservations — release them before deleting.
        for (const item of items) {
          if (item.type === 'product' && !item.isPreOrder && Number(item.refId) > 0) {
            const product = await productService.get(Number(item.refId));
            if (product) {
              await productService.update(product.id, {
                reservedStock: Math.max(0, (product.reservedStock || 0) - (item.quantity || 0)),
              });
            }
          }
        }
      } else if (tx && isCompletedStatus(tx.status)) {
        // Completed jobs deducted stock — restore it on delete (legacy undo behaviour).
        for (const item of items) {
          if (item.type === 'product' && !item.isPreOrder && Number(item.refId) > 0) {
            const product = await productService.get(Number(item.refId));
            if (product) {
              await productService.update(product.id, {
                stock: (product.stock ?? 0) + (item.quantity || 0),
              });
            }
          }
        }
      }
      for (const item of items) {
        if (item.id) await transactionItemService.delete(item.id);
      }
      await transactionService.delete(id);
      const label = tx ? `${tx.customerName || tx.customer || 'Walk-in'} (${tx.jobNumber || `#${id}`})` : `job #${id}`;
      void activityService.log('transaction.delete', `Deleted ${label}`, {
        entityType: 'transaction', entityId: id,
        details: tx ? `status=${tx.status} total=${tx.totalAmount ?? tx.total ?? 0}` : undefined,
      });
    },
    onSuccess: () => invalidate(),
  });
}

// Job lifecycle hooks (Save as Pending / Edit / Complete / Cancel / Deposit)
export function useSavePendingJob(): UseMutationResult<{ id: number; jobNumber: string; trackingToken: string }, unknown, JobInput, unknown> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: (input: JobInput) => jobService.saveAsPending(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdatePendingJob(): UseMutationResult<
  { id: number; jobNumber: string; trackingToken: string },
  unknown,
  { id: number; data: JobInput; additionalDeposit?: number; additionalDepositMethod?: 'cash' | 'gcash'; status?: TransactionStatus },
  unknown
> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: ({ id, data, additionalDeposit, additionalDepositMethod, status }) =>
      jobService.updatePendingJob(id, data, { additionalDeposit, additionalDepositMethod, status }),
    onSuccess: () => invalidate(),
  });
}

export function useCompleteTransaction(): UseMutationResult<
  JobCompletionResult,
  unknown,
  { id?: number; data: JobInput; paymentMethod: 'cash' | 'gcash'; cashReceived?: number },
  unknown
> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async ({ id, data, paymentMethod, cashReceived }) => {
      if (id) {
        const result = await jobService.completeJob(id, { paymentMethod, cashReceived });
        void activityService.log('transaction.complete', `Completed job #${id} via ${paymentMethod}`, {
          entityType: 'transaction', entityId: id,
        });
        return result;
      }
      const result = await jobService.completeNewJob(data, { cashReceived });
      void activityService.log('transaction.complete', `Completed walk-in sale via ${paymentMethod}`, {
        entityType: 'transaction', entityId: result?.jobNumber || result?.id,
      });
      return result;
    },
    onSuccess: () => invalidate(),
  });
}

export function useCancelTransaction(): UseMutationResult<void, unknown, { id: number }, unknown> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async ({ id }) => {
      await jobService.cancelJob(id);
      void activityService.log('transaction.cancel', `Cancelled job #${id}`, {
        entityType: 'transaction', entityId: id,
      });
    },
    onSuccess: () => invalidate(),
  });
}

export function useRecordDeposit(): UseMutationResult<
  { paymentStatus: string; remainingBalance: number; amountPaid: number },
  unknown,
  { id: number; data: { amount: number; method: 'cash' | 'gcash'; note?: string } },
  unknown
> {
  const invalidate = useInvalidateBusinessData();
  return useMutation({
    mutationFn: async ({ id, data }) => {
      const result = await jobService.recordDeposit(id, data);
      void activityService.log('drawer.deposit', `Deposit ₱${data.amount} on job #${id} (${data.method})`, {
        entityType: 'transaction', entityId: id,
      });
      return result;
    },
    onSuccess: () => invalidate(),
  });
}

// Transaction Stats Hook
export function useGetTransactionStats(
  params?: { period?: string },
): UseQueryResult<TransactionStats, unknown> {
  return useQuery({
    queryKey: ['transactionStats', params?.period],
    queryFn: () =>
      transactionService.getStats((params?.period || 'today') as any),
    staleTime: Infinity,
  });
}

// Defective Items Hooks
export function useListDefectiveItems(
  _params?: any,
): UseQueryResult<DefectiveItem[], unknown> {
  return useQuery({
    queryKey: ['defectiveItems'],
    queryFn: () => defectiveItemService.list(),
    staleTime: Infinity,
  });
}

export function useCreateDefectiveItem(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => defectiveItemService.create(data?.data || data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['defectiveItems'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// Backjob Hooks
export function useListBackjobs(
  _params?: any,
): UseQueryResult<Backjob[], unknown> {
  return useQuery({
    queryKey: ['backjobs'],
    queryFn: () => backjobService.list(),
    staleTime: Infinity,
  });
}

export function useGetBackjob(id: number | undefined): UseQueryResult<Backjob | undefined, unknown> {
  return useQuery({
    queryKey: ['backjob', id],
    queryFn: () => (id ? backjobService.get(id) : undefined),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useCreateBackjob(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: any) => backjobService.create(data?.data || data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backjobs'] });
    },
  });
}

export function useUpdateBackjobStatus(): UseMutationResult<void, unknown, { id: number; status?: string; data?: { status: string } }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, data }) =>
      backjobService.update(id, { status: ((data?.status || status) as any) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backjobs'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useDeleteBackjob(): UseMutationResult<void, unknown, { id: number }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) => backjobService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backjobs'] });
    },
  });
}

// Cash Drawer Hooks
export function useGetCashDrawer(): UseQueryResult<{ balance: number; entries: any[] }, unknown> {
  return useQuery({
    queryKey: ['cashDrawer'],
    queryFn: () => cashDrawerService.get(),
    staleTime: Infinity,
  });
}

export function useAddCashDrawerEntry(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry) => {
      const id = await cashDrawerService.addEntry(entry);
      void activityService.log(
        entry?.type === 'withdraw' ? 'drawer.withdraw' : 'drawer.deposit',
        `Cash ${entry?.type || 'entry'} ₱${entry?.amount || 0}`,
        { entityType: 'cashDrawer', entityId: id },
      );
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawer'] });
    },
  });
}

// Gcash Drawer Hooks
export function useGetGcashDrawer(): UseQueryResult<{ balance: number; entries: any[] }, unknown> {
  return useQuery({
    queryKey: ['gcashDrawer'],
    queryFn: () => gcashDrawerService.get(),
    staleTime: Infinity,
  });
}

export function useAddGcashDrawerEntry(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (entry) => {
      const id = await gcashDrawerService.addEntry(entry);
      void activityService.log(
        entry?.type === 'withdraw' ? 'drawer.withdraw' : 'drawer.deposit',
        `GCash ${entry?.type || 'entry'} ₱${entry?.amount || 0}`,
        { entityType: 'gcashDrawer', entityId: id },
      );
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gcashDrawer'] });
    },
  });
}

// Settings Hooks
export function useActivityLogs(limit = 300): UseQueryResult<ActivityLog[], unknown> {
  return useQuery({
    queryKey: ['activityLogs', limit],
    queryFn: () => activityService.list(limit),
    staleTime: 30_000,
  });
}

export function useGetSettings(): UseQueryResult<Record<string, any>, unknown> {
  return useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsService.get(),
    staleTime: Infinity,
  });
}

export function useUpdateSettings(): UseMutationResult<void, unknown, { data: Record<string, any> }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ data }) => {
      for (const [key, value] of Object.entries(data)) {
        await settingsService.set(key, value);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
  });
}

// Shop Profile Hook
export function useShopProfile(): ShopProfile {
  const { data: settings } = useGetSettings();
  return useMemo(() => shopProfileFromSettings(settings), [settings]);
}

// Dashboard Hook
export function useGetDashboard(params?: { period?: string }): UseQueryResult<Dashboard, unknown> {
  return useQuery({
    queryKey: ['dashboard', params?.period],
    queryFn: () =>
      dashboardService.getDashboard((params?.period || 'today') as any),
    staleTime: Infinity,
  });
}

// Report Hooks
export function useGetMonthlyReport(params?: { month?: string }): UseQueryResult<MonthlyReport, unknown> {
  return useQuery({
    queryKey: ['monthlyReport', params?.month],
    queryFn: () => dashboardService.getMonthlyReport(params?.month),
    staleTime: Infinity,
  });
}

export function useGetTechnicianReport(params?: { period?: string }): UseQueryResult<TechnicianReportRow[], unknown> {
  return useQuery({
    queryKey: ['technicianReport', params?.period],
    queryFn: () => dashboardService.getTechnicianReport(params?.period),
    staleTime: Infinity,
  });
}

// Customer Lookup Hook (kept for API compatibility)
export function useLookupCustomer(params?: { query?: string }): UseQueryResult<any, unknown> {
  return useQuery({
    queryKey: ['customerLookup', params?.query],
    queryFn: async () => {
      if (params?.query) {
        const txs = await transactionService.list({ search: params.query });
        return txs[0] || null;
      }
      return null;
    },
    staleTime: 60_000,
  });
}

// Cash Drawer Operations (Deposits/Withdrawals)
export function useCashDeposit(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const d = payload?.data || payload;
      const amount = Number(d?.amount || 0);
      const note = d?.note || d?.notes || 'Deposit';
      const id = await cashDrawerService.addEntry({ type: 'deposit', amount, note, notes: note });
      void activityService.log('drawer.deposit', `Cash deposit ₱${amount} — ${note}`, {
        entityType: 'cashDrawer', entityId: id,
      });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawer'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useCashWithdraw(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const d = payload?.data || payload;
      const amount = Number(d?.amount || 0);
      const note = d?.note || d?.notes || 'Withdrawal';
      const id = await cashDrawerService.addEntry({ type: 'withdraw', amount, note, notes: note });
      void activityService.log('drawer.withdraw', `Cash withdraw ₱${amount} — ${note}`, {
        entityType: 'cashDrawer', entityId: id,
      });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cashDrawer'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// Gcash Drawer Operations (Deposits/Withdrawals)
export function useGcashDeposit(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const d = payload?.data || payload;
      const amount = Number(d?.amount || 0);
      const note = d?.note || d?.notes || 'GCash Deposit';
      const id = await gcashDrawerService.addEntry({ type: 'deposit', amount, note, notes: note });
      void activityService.log('drawer.deposit', `GCash deposit ₱${amount} — ${note}`, {
        entityType: 'gcashDrawer', entityId: id,
      });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gcashDrawer'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

export function useGcashWithdraw(): UseMutationResult<number, unknown, any> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: any) => {
      const d = payload?.data || payload;
      const amount = Number(d?.amount || 0);
      const note = d?.note || d?.notes || 'GCash Withdrawal';
      const id = await gcashDrawerService.addEntry({ type: 'withdraw', amount, note, notes: note });
      void activityService.log('drawer.withdraw', `GCash withdraw ₱${amount} — ${note}`, {
        entityType: 'gcashDrawer', entityId: id,
      });
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gcashDrawer'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

// Change Password Hook
export function useChangePassword(): UseMutationResult<any, unknown, { data: { currentPassword?: string; password?: string; newPassword: string } }> {
  return useMutation({
    mutationFn: async ({ data }) => {
      const stored = localStorage.getItem('jegz_session_user');
      if (!stored) throw new Error("Not logged in");
      const sessionUser = JSON.parse(stored);
      const dbUser = await localDb.users.get(sessionUser.id);
      if (!dbUser) throw new Error("User not found");

      const curr = data.currentPassword || data.password;
      if (curr && dbUser.passwordHash) {
        const valid = await bcrypt.compare(curr, dbUser.passwordHash as string);
        if (!valid) throw new Error("Incorrect current password");
      }
      const newHash = await bcrypt.hash(data.newPassword, 10);
      await localDb.users.update(dbUser.id as number, { passwordHash: newHash });
      return { success: true };
    },
  });
}

// ─── Data bootstrap for migrated legacy DBs ────────────────────────────────
export function useBootstrapMigration() {
  const [done, setDone] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        await ensureJobNumbers();
        await normalizeLowStockDefaults();
        await normalizeServiceCatalog();
      } catch (e) {
        console.error('Migration bootstrap failed:', e);
      } finally {
        setDone(true);
      }
    })();
  }, []);
  return done;
}

// Query Key Getters (for cache invalidation)
export function getGetCashDrawerQueryKey() {
  return ['cashDrawer'] as const;
}

export function getGetGcashDrawerQueryKey() {
  return ['gcashDrawer'] as const;
}

export function getListProductsQueryKey() {
  return ['products'] as const;
}

export function getListServicesQueryKey() {
  return ['services'] as const;
}

export function getListTechniciansQueryKey() {
  return ['technicians'] as const;
}

export function getListTransactionsQueryKey() {
  return ['transactions'] as const;
}

export function getListDefectiveItemsQueryKey() {
  return ['defectiveItems'] as const;
}

export function getListBackjobsQueryKey() {
  return ['backjobs'] as const;
}

export function getGetTransactionStatsQueryKey(params?: any) {
  return ['transactionStats', params?.period] as const;
}

export function getGetDashboardQueryKey(params?: any) {
  return ['dashboard', params?.period] as const;
}