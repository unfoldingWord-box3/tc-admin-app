# Treat Door43 health as release authority

Status: accepted

tC Admin will use the Door43 health-check service as the authoritative health result and will not invent a more permissive local interpretation. A failed, unavailable, or unexpected health check blocks release creation; the manager can retry after the dependency becomes available. Deeper file-content validation remains a later feature.
