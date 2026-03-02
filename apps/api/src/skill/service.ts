import type { SkillIndexEntry, SkillPreview, SkillPreviewRequest } from "./types";

/**
 * SkillService is the single future owner for registry/frontmatter/preview logic.
 * CL-08-A lands the seam first; discovery/runtime behavior is added in later cycles.
 */
export class SkillService {
	async listSkills(): Promise<SkillIndexEntry[]> {
		return [];
	}

	async previewSkill(
		_input: SkillPreviewRequest,
	): Promise<SkillPreview | null> {
		return null;
	}
}
