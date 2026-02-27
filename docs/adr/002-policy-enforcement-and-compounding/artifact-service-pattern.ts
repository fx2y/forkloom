export async function putArtifact(input: PutArtifactInput): Promise<ArtifactModel> {
  // 1. Check existing to avoid redundant writes (idempotency hint)
  const sha256 = hashBytes(input.body);
  const existing = await this.deps.repo.getBySha256(sha256);
  if (existing) return existing;

  // 2. RESERVE in SQL (Atomic Checkpoint)
  const reservation = await this.stepRunner.runStep(
    "artifact-insert-meta",
    () => this.deps.repo.insertIfAbsent({
      sha256,
      uri: `s3://${this.deps.s3Bucket}/cas/${sha256.slice(0, 2)}/${sha256}`,
      // ... metadata
    })
  );

  // 3. WRITE to Storage (Side-effect)
  try {
    await this.stepRunner.runStep("artifact-put-object", () =>
      this.deps.store.putObject({ sha256, body: input.body })
    );
  } catch (error) {
    // 4. ROLLBACK Reservation on storage failure
    await this.deps.repo.deleteBySha256(sha256);
    throw error;
  }

  return reservation.artifact;
}
