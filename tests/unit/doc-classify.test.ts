import { describe, expect, it } from "vitest";
import { classifyDoc, countPdfPages } from "../../apps/api/src/doc";

function pdfWithPages(pages: number): Buffer {
	const chunks: string[] = ["%PDF-1.7"];
	for (let i = 0; i < pages; i += 1) {
		chunks.push(`/Type /Page ${i}`);
	}
	return Buffer.from(chunks.join("\n"), "latin1");
}

describe("doc classify", () => {
	it("counts pdf pages from bytes", () => {
		expect(countPdfPages(pdfWithPages(3))).toBe(3);
		expect(countPdfPages(Buffer.from("%PDF-1.7", "latin1"))).toBe(1);
	});

	it("rejects oversized pdf/image and unsupported mime deterministically", () => {
		const pdfBytesReject = classifyDoc({
			mime: "application/pdf",
			bytes: 60,
			body: pdfWithPages(1),
			pdfMaxBytes: 50,
			pdfMaxPages: 100,
			imageMaxBytes: 10,
		});
		expect(pdfBytesReject).toMatchObject({
			accepted: false,
			kind: "pdf",
			code: "pdf_bytes_limit",
		});

		const pdfPagesReject = classifyDoc({
			mime: "application/pdf",
			bytes: 10,
			body: pdfWithPages(4),
			pdfMaxBytes: 50,
			pdfMaxPages: 3,
			imageMaxBytes: 10,
		});
		expect(pdfPagesReject).toMatchObject({
			accepted: false,
			kind: "pdf",
			code: "pdf_pages_limit",
			actual: 4,
			limit: 3,
		});

		const imageReject = classifyDoc({
			mime: "image/png",
			bytes: 11,
			body: Buffer.from([1]),
			pdfMaxBytes: 50,
			pdfMaxPages: 3,
			imageMaxBytes: 10,
		});
		expect(imageReject).toMatchObject({
			accepted: false,
			kind: "image",
			code: "image_bytes_limit",
		});

		const unsupported = classifyDoc({
			mime: "text/plain",
			bytes: 1,
			body: Buffer.from("x"),
			pdfMaxBytes: 50,
			pdfMaxPages: 3,
			imageMaxBytes: 10,
		});
		expect(unsupported).toMatchObject({
			accepted: false,
			kind: "unknown",
			code: "unsupported_mime",
		});
	});

	it("accepts in-limit pdf/image", () => {
		const pdfAccepted = classifyDoc({
			mime: "application/pdf",
			bytes: 10,
			body: pdfWithPages(2),
			pdfMaxBytes: 50,
			pdfMaxPages: 3,
			imageMaxBytes: 10,
		});
		expect(pdfAccepted).toEqual({
			accepted: true,
			kind: "pdf",
			bytes: 10,
			pages: 2,
		});

		const imageAccepted = classifyDoc({
			mime: "image/jpeg",
			bytes: 10,
			body: Buffer.from([1, 2]),
			pdfMaxBytes: 50,
			pdfMaxPages: 3,
			imageMaxBytes: 10,
		});
		expect(imageAccepted).toEqual({
			accepted: true,
			kind: "image",
			bytes: 10,
		});
	});
});
