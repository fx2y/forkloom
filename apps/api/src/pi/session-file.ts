import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const PI_SESSION_HEADER_VERSION = 3;

export type PiSessionFileState = {
	sessionFile: string;
	sessionId: string;
};

export async function ensureSessionFileExists(
	state: PiSessionFileState,
	cwd = process.cwd(),
): Promise<void> {
	if (existsSync(state.sessionFile)) {
		return;
	}
	await mkdir(dirname(state.sessionFile), { recursive: true });
	try {
		await writeFile(
			state.sessionFile,
			`${JSON.stringify({
				type: "session",
				version: PI_SESSION_HEADER_VERSION,
				id: state.sessionId,
				timestamp: new Date().toISOString(),
				cwd,
			})}\n`,
			{ encoding: "utf8", flag: "wx" },
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
	}
}
