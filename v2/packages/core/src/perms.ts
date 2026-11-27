/* Permissions are checked in the core, never only in the UI. Same table as v1 src/auth.js. */
const OPS = ['read', 'sale.create', 'customer.create', 'payment.create', 'shift.open', 'shift.close'];
export const PERMS: Record<string, Set<string>> = {
  owner: new Set(['*']),
  admin: new Set(['*']),
  manager: new Set([...OPS, 'report.read', 'audit.read', 'sale.void', 'sale.backdate', 'delivery.create', 'delivery.void', 'expense.create', 'expense.void',
    'payment.void', 'adjust.create', 'transfer.create', 'transfer.void', 'config.edit', 'price.edit', 'supplier.manage', 'supplier.pay',
    'customer.edit', 'cash.move', 'shift.approve', 'journal.read', 'voucher.create', 'voucher.void', 'sale.discount', 'bank.reconcile', 'payroll.manage', 'payroll.pay']),
  accountant: new Set(['read', 'report.read', 'audit.read', 'customer.create', 'customer.edit', 'payment.create', 'payment.void', 'expense.create', 'expense.void',
    'supplier.manage', 'supplier.pay', 'shift.approve', 'journal.read', 'journal.create', 'journal.post', 'journal.reverse', 'period.lock', 'account.edit', 'voucher.create', 'voucher.void', 'bank.reconcile', 'payroll.manage', 'payroll.pay']),
  supervisor: new Set([...OPS, 'report.read', 'sale.void', 'sale.discount', 'delivery.create', 'expense.create', 'adjust.create', 'cash.move']),
  cashier: new Set(OPS),
  viewer: new Set(['read', 'report.read'])
};
export const ORG_WIDE = new Set(['owner', 'admin']);
export function can(role: string, perm: string): boolean { const p = PERMS[role]; return !!p && (p.has('*') || p.has(perm)); }
