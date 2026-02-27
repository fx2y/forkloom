export const PI_COMMANDS = [
	"prompt",
	"steer",
	"follow_up",
	"abort",
	"get_state",
	"get_last_assistant_text",
	"get_session_stats",
] as const;

export type PiCommand = (typeof PI_COMMANDS)[number];
