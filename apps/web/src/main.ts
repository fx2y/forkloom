import { mountApp } from "./app";

const root = document.querySelector<HTMLElement>("#app");

if (!root) {
	throw new Error("missing #app root");
}

mountApp(root);
