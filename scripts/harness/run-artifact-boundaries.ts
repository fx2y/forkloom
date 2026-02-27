import {
	fetchArtifactBytes,
	fetchArtifactDigest,
	queryRows,
	uploadArtifactBuffer,
	writeJson,
} from "./run-live-support";

const LARGE_BYTES = 100 * 1024 * 1024;

async function main(): Promise<void> {
	const zero = await uploadArtifactBuffer({
		filename: "empty.bin",
		body: Buffer.alloc(0),
		mime: "application/octet-stream",
	});
	const zeroBytes = await fetchArtifactBytes(zero.sha256);
	if (zeroBytes.byteLength !== 0) {
		throw new Error(`expected zero-byte artifact, got ${zeroBytes.byteLength}`);
	}

	const largeBody = Buffer.alloc(LARGE_BYTES, 120);
	const large = await uploadArtifactBuffer({
		filename: "large.bin",
		body: largeBody,
		mime: "application/octet-stream",
	});
	if (large.bytes !== LARGE_BYTES) {
		throw new Error(`large artifact meta mismatch: ${large.bytes}`);
	}
	const digest = await fetchArtifactDigest(large.sha256);
	if (digest.bytes !== LARGE_BYTES || digest.sha256 !== large.sha256) {
		throw new Error("large artifact download hash mismatch");
	}

	const byteaColumns = await queryRows<{
		table_name: string;
		column_name: string;
	}>(
		`select table_name, column_name
		 from information_schema.columns
		 where table_schema = 'public'
		   and table_name in ('artifact','artifact_alias','runs','events','run_artifacts')
		   and data_type = 'bytea'
		 order by table_name, column_name`,
	);
	if (byteaColumns.length > 0) {
		throw new Error(
			`pointer-only storage violated: ${JSON.stringify(byteaColumns)}`,
		);
	}

	await writeJson(".cache/test-int/artifact-boundaries.json", {
		zero: {
			sha256: zero.sha256,
			bytes: zeroBytes.byteLength,
		},
		large: {
			sha256: large.sha256,
			bytes: digest.bytes,
		},
		byteaColumns,
	});
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
