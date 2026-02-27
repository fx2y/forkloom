import { createServer } from "node:http";

const tools = ["read", "write", "edit", "bash"];

const server = createServer((req, res) => {
	if (req.url === "/health") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true, tools }));
		return;
	}

	if (req.url === "/rpc" && req.method === "POST") {
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ ok: true }));
		return;
	}

	res.writeHead(404, { "content-type": "application/json" });
	res.end(JSON.stringify({ error: "not found" }));
});

server.listen(7070, "0.0.0.0", () => {
	console.log(JSON.stringify({ msg: "pi mock rpc listening", port: 7070 }));
});
