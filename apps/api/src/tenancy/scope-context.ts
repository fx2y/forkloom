import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantScopeContext } from "../run/ports";

const tenantScopeStore = new AsyncLocalStorage<TenantScopeContext>();

export function runWithTenantScope<T>(
	scope: TenantScopeContext,
	fn: () => Promise<T> | T,
): Promise<T> | T {
	return tenantScopeStore.run(scope, fn);
}

export function getTenantScope(): TenantScopeContext | undefined {
	return tenantScopeStore.getStore();
}
