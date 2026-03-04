import type { TenantScopeContext, WriteTarget } from "../run/ports";

type ScopeIdentityInput = {
	orgId: string;
	wsId?: string | undefined;
	memberId?: string | undefined;
};

export function canonicalizeWriteTarget(
	writeTarget: WriteTarget,
	scope: ScopeIdentityInput,
): TenantScopeContext {
	if (!scope.orgId || scope.orgId.trim().length === 0) {
		throw new Error("orgId is required");
	}
	const orgId = scope.orgId.trim();
	const wsId = scope.wsId?.trim() || undefined;
	const memberId = scope.memberId?.trim() || undefined;
	if (writeTarget === "org") {
		return { orgId, wsId: undefined, memberId: undefined, writeTarget };
	}
	if (writeTarget === "ws") {
		if (!wsId) {
			throw new Error("wsId required for ws write target");
		}
		return { orgId, wsId, memberId: undefined, writeTarget };
	}
	if (!wsId || !memberId) {
		throw new Error("wsId and memberId required for member write target");
	}
	return { orgId, wsId, memberId, writeTarget };
}
