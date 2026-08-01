/**
 * Flags for surfaces that exist in the UI but aren't yet ready to ship. Each
 * one is a single switch to flip when the backing work lands — not a permanent
 * branch in the product.
 */

/**
 * The Eval page (gate KPIs, score trend, runs, per-component breakdown).
 *
 * Off, because eval is deferred to a later phase. The page and its store are
 * complete and stay fully tested — this only removes it from the product
 * surface (nav entry, route, contextual sidebar), which are all driven by the
 * single `pages` registry, so excluding the entry there covers all three.
 * `/eval` typed directly falls through the router's catch-all to the default
 * landing route rather than rendering a dead page.
 *
 * Flip to `true` to bring it back; nothing else needs rewriting.
 */
export const EVAL_UI_ENABLED = false;

/**
 * Publishing / sharing an artifact.
 *
 * Off, because nothing is actually hosted yet: the server records a
 * placeholder URL on a reserved `.example` domain, which can never resolve.
 * Offering a Publish action whose result cannot be opened is worse than not
 * offering it, so while this is `false` every publish affordance is hidden —
 * the artifact-detail Publish card, the in-thread publish button, and the
 * published-result card.
 *
 * Flip to `true` once publishing really hosts the artifact; the hidden
 * components are otherwise complete and their call sites still pass real
 * props, so nothing else needs rewriting.
 */
export const PUBLISH_UI_ENABLED = false;
