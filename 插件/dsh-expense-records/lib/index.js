// dsh-expense-recodes — host half.
//
// The whole feature lives on the client (floating cost window + settings
// section + localStorage price store), so this half is intentionally minimal:
// it still declares the plugin identity the dsh loader requires. The real work
// (slot registrations, token-usage projection subscription, price store) is in
// lib/client.js, which the web client module system loads via
// `dsh.client` -> `exports["./client"]`.
const name = "dsh-expense-recodes";

/** No host services are required; the client half injects its own. */
const inject = [];

/**
 * Host apply — no-op by design.
 * @param {import("@deepseek-ai/cordis").Context} ctx - host context (unused).
 */
function apply(ctx) {
	// Nothing to do on the host: pricing data lives in the browser (localStorage)
	// and token usage is read on the client from the session tokenUsage projection.
}

export { apply, inject, name };