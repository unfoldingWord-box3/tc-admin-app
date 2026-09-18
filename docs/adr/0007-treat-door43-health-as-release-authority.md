# Treat Door43 health as release authority

Status: accepted; amended 18 September 2026 (proposed until the pull request merges)

tC Admin will use the Door43 health-check service as the authoritative health result and will not invent a more permissive local interpretation. A failed, unavailable, or unexpected health check blocks release creation; the manager can retry after the dependency becomes available. Deeper file-content validation remains a later feature.

Amendment (Q6): a `warning` severity on the release snapshot does not block release creation. tC Admin shows the warnings and requires the manager to confirm they want to proceed; the release operation is refused until that confirmation is given. This keeps Door43 as the authority on what the warnings are while leaving the manager the decision, which is what they have today when releasing by hand.
