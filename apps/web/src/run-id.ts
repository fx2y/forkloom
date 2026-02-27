const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: number, length: number): string {
	let out = "";
	let cursor = value;
	for (let index = 0; index < length; index += 1) {
		out = CROCKFORD[cursor % 32] + out;
		cursor = Math.floor(cursor / 32);
	}
	return out;
}

function encodeRandom(random: Uint8Array): string {
	let out = "";
	for (const value of random) {
		out += CROCKFORD[value % 32];
	}
	return out.slice(0, 16);
}

export function createRunId(now = Date.now()): string {
	const random = new Uint8Array(16);
	crypto.getRandomValues(random);
	return `${encodeBase32(now, 10)}${encodeRandom(random)}`;
}
