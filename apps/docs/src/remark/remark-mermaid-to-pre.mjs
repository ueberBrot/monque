/**
 * remark plugin: convert ```mermaid fences into <pre class="mermaid"> blocks.
 *
 * This enables client-side Mermaid rendering (no build-time renderers).
 * Workaround until astro-mermaid fixes its claude-code runtime dependency addition.
 */

function escapeHtml(value) {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export default function remarkMermaidToPre() {
	return (tree) => {
		/** @type {any[]} */
		const stack = [tree];

		while (stack.length > 0) {
			const node = stack.pop();
			if (!node || typeof node !== 'object') continue;

			if (node.type === 'code' && node.lang?.toLowerCase() === 'mermaid') {
				node.type = 'html';
				node.value = `<pre class="mermaid">\n${escapeHtml(node.value ?? '')}\n</pre>`;
				delete node.lang;
				delete node.meta;
				continue;
			}

			if (Array.isArray(node.children)) {
				for (const child of node.children) stack.push(child);
			}
		}
	};
}
