import { Readable } from "node:stream";
import {
	CreateBucketCommand,
	GetObjectCommand,
	HeadBucketCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { casKey } from "@forkloom/shared";
import type { ArtifactStore, PutObjectInput } from "../ports";

type S3Deps = {
	endpoint: string;
	bucket: string;
	region: string;
	accessKeyId: string;
	secretAccessKey: string;
	client?: Pick<S3Client, "send"> | undefined;
};

type S3ErrorLike = {
	name?: string;
	code?: string;
	Code?: string;
	$metadata?: {
		httpStatusCode?: number;
	};
};

function toReadable(body: unknown): Readable {
	if (body instanceof Readable) {
		return body;
	}
	if (body instanceof Uint8Array || Buffer.isBuffer(body)) {
		return Readable.from(body);
	}
	if (
		body &&
		typeof body === "object" &&
		Symbol.asyncIterator in (body as object)
	) {
		return Readable.from(body as AsyncIterable<Uint8Array>);
	}
	throw new Error("unsupported s3 body stream");
}

export class S3ArtifactStore implements ArtifactStore {
	private readonly client: Pick<S3Client, "send">;

	constructor(private readonly deps: S3Deps) {
		this.client =
			deps.client ??
			new S3Client({
				endpoint: deps.endpoint,
				region: deps.region,
				forcePathStyle: true,
				credentials: {
					accessKeyId: deps.accessKeyId,
					secretAccessKey: deps.secretAccessKey,
				},
			});
	}

	private static isMissingBucketError(error: unknown): boolean {
		const s3Error = error as S3ErrorLike;
		return (
			s3Error?.$metadata?.httpStatusCode === 404 ||
			s3Error?.name === "NotFound" ||
			s3Error?.code === "NotFound" ||
			s3Error?.Code === "NotFound" ||
			s3Error?.name === "NoSuchBucket"
		);
	}

	private static isBucketAlreadyExistsError(error: unknown): boolean {
		const s3Error = error as S3ErrorLike;
		return (
			s3Error?.$metadata?.httpStatusCode === 409 ||
			s3Error?.name === "BucketAlreadyExists" ||
			s3Error?.name === "BucketAlreadyOwnedByYou" ||
			s3Error?.code === "BucketAlreadyExists" ||
			s3Error?.code === "BucketAlreadyOwnedByYou" ||
			s3Error?.Code === "BucketAlreadyExists" ||
			s3Error?.Code === "BucketAlreadyOwnedByYou"
		);
	}

	async ensureBucket(): Promise<void> {
		try {
			await this.client.send(
				new HeadBucketCommand({ Bucket: this.deps.bucket }),
			);
			return;
		} catch (error) {
			if (!S3ArtifactStore.isMissingBucketError(error)) {
				throw error;
			}
		}

		try {
			await this.client.send(
				new CreateBucketCommand({ Bucket: this.deps.bucket }),
			);
		} catch (error) {
			if (!S3ArtifactStore.isBucketAlreadyExistsError(error)) {
				throw error;
			}
		}
	}

	async putObject(input: PutObjectInput): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: this.deps.bucket,
				Key: casKey(input.sha256),
				Body: input.body,
				ContentType: input.mime,
			}),
		);
	}

	async getObject(
		sha256: string,
	): Promise<{ body: Readable; contentType: string | null }> {
		const result = await this.client.send(
			new GetObjectCommand({
				Bucket: this.deps.bucket,
				Key: casKey(sha256),
			}),
		);
		if (!result.Body) {
			throw new Error("s3 object body missing");
		}

		return {
			body: toReadable(result.Body),
			contentType: result.ContentType ?? null,
		};
	}

	async ping(): Promise<boolean> {
		try {
			await this.client.send(
				new HeadBucketCommand({ Bucket: this.deps.bucket }),
			);
			return true;
		} catch {
			return false;
		}
	}
}
