import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import type { ArtifactMeta, ArtifactModel, ArtifactRepo } from "../ports";

export type PgDeps = {
	databaseUrl: string;
	migrationsDir: string;
};

type ArtifactRow = {
	sha256: string;
	uri: string;
	mime: string;
	bytes: string | number;
	created_at: string | Date;
	type: ArtifactModel["type"];
	parents: string[] | null;
	meta: ArtifactMeta | null;
};

function toModel(row: ArtifactRow): ArtifactModel {
	const createdAt =
		row.created_at instanceof Date
			? row.created_at.toISOString()
			: new Date(row.created_at).toISOString();

	return {
		sha256: row.sha256,
		uri: row.uri,
		mime: row.mime,
		bytes: Number(row.bytes),
		createdAt,
		type: row.type,
		parents: row.parents ?? [],
		meta: row.meta ?? {},
	};
}

export class PgArtifactRepo implements ArtifactRepo {
	private readonly pool: pg.Pool;

	constructor(private readonly deps: PgDeps) {
		this.pool = new pg.Pool({ connectionString: deps.databaseUrl });
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	async runMigrations(): Promise<void> {
		const dir = resolve(this.deps.migrationsDir);
		if (!existsSync(dir)) {
			return;
		}

		const files = readdirSync(dir)
			.filter((name) => name.endsWith(".sql"))
			.sort();

		for (const file of files) {
			const sql = readFileSync(join(dir, file), "utf8");
			await this.pool.query(sql);
		}
	}

	async ping(): Promise<boolean> {
		try {
			await this.pool.query("select 1");
			return true;
		} catch {
			return false;
		}
	}

	async getBySha256(sha256: string): Promise<ArtifactModel | null> {
		const result = await this.pool.query<ArtifactRow>(
			`select sha256, uri, mime, bytes, created_at, type, parents, meta
			 from artifact where sha256 = $1`,
			[sha256],
		);
		if (!result.rowCount) {
			return null;
		}
		const row = result.rows[0];
		if (!row) {
			throw new Error("artifact row missing after select");
		}
		return toModel(row);
	}

	async insert(model: ArtifactModel): Promise<ArtifactModel> {
		const result = await this.pool.query<ArtifactRow>(
			`insert into artifact(sha256, uri, mime, bytes, created_at, type, parents, meta)
			 values ($1, $2, $3, $4, $5::timestamptz, $6, $7::text[], $8::jsonb)
			 on conflict (sha256) do nothing
			 returning sha256, uri, mime, bytes, created_at, type, parents, meta`,
			[
				model.sha256,
				model.uri,
				model.mime,
				model.bytes,
				model.createdAt,
				model.type,
				model.parents,
				JSON.stringify(model.meta),
			],
		);

		if (result.rowCount) {
			const row = result.rows[0];
			if (!row) {
				throw new Error("artifact row missing after insert");
			}
			return toModel(row);
		}

		const existing = await this.getBySha256(model.sha256);
		if (!existing) {
			throw new Error("insert raced but row is missing");
		}
		return existing;
	}

	async appendLink(
		sha256: string,
		parent: string | null,
		metaPatch: ArtifactMeta,
	): Promise<ArtifactModel | null> {
		const result = await this.pool.query<ArtifactRow>(
			`update artifact
			 set parents = case
			   when $2::text is null then parents
			   when $2::text = any(parents) then parents
			   else array_append(parents, $2::text)
			 end,
			 meta = coalesce(meta, '{}'::jsonb) || $3::jsonb
			 where sha256 = $1
			 returning sha256, uri, mime, bytes, created_at, type, parents, meta`,
			[sha256, parent, JSON.stringify(metaPatch)],
		);
		if (!result.rowCount) {
			return null;
		}
		const row = result.rows[0];
		if (!row) {
			throw new Error("artifact row missing after link");
		}
		return toModel(row);
	}
}
