import type { Request } from "express";
import { HttpError } from "../errors";
import type { TenantScopeContext, WriteTarget } from "../run/ports";
import { getTenantScope, runWithTenantScope } from "../tenancy/scope-context";

export function resolveScope(req: Request): TenantScopeContext {
	const orgId = req.header("x-org-id");
	if (!orgId) {
		throw new HttpError(401, "x-org-id header required");
	}
	const wsId = req.header("x-ws-id") || undefined;
	const memberId = req.header("x-member-id") || undefined;
	const writeTargetRaw = req.header("x-write-scope") || "ws";

	if (
		writeTargetRaw !== "org" &&
		writeTargetRaw !== "ws" &&
		writeTargetRaw !== "member"
	) {
		throw new HttpError(400, "x-write-scope must be one of org|ws|member");
	}
	const writeTarget = writeTargetRaw as WriteTarget;

	// Validation of scope lattice
	if (writeTarget === "ws" && !wsId) {
		throw new HttpError(400, "wsId required for ws write target");
	}
	if (writeTarget === "member" && (!wsId || !memberId)) {
		throw new HttpError(
			400,
			"wsId and memberId required for member write target",
		);
	}

	return {
		orgId,
		wsId,
		memberId,
		writeTarget,
	};
}

export async function withScopeTx<T>(
	repo: { query: (sql: string, args?: unknown[]) => Promise<unknown> },
	scope: TenantScopeContext,
	fn: () => Promise<T>,
): Promise<T> {
	await repo.query("BEGIN");
	try {
		await repo.query("SELECT set_config('app.org_id', $1, true)", [
			scope.orgId,
		]);
		await repo.query("SELECT set_config('app.ws_id', $1, true)", [
			scope.wsId ?? "",
		]);
		await repo.query("SELECT set_config('app.member_id', $1, true)", [
			scope.memberId ?? "",
		]);
		const out = await fn();
		await repo.query("COMMIT");
		return out;
	} catch (e) {
		await repo.query("ROLLBACK");
		throw e;
	}
}

export { getTenantScope, runWithTenantScope };
