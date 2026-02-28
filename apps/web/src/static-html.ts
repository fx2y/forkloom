export function parseStaticFragment(html: string): DocumentFragment {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const fragment = document.createDocumentFragment();
	for (const node of Array.from(doc.body.childNodes)) {
		fragment.append(node);
	}
	return fragment;
}
