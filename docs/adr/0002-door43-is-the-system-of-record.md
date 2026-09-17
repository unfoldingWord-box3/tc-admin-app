# Keep Door43 as the system of record

Status: accepted

Door43 remains authoritative for users, permissions, repository files, commits, tags, releases, and repository history. tC Admin may cache transient metadata and workflow state, but it will not create a competing content store, authorization model, or durable release ledger. This avoids divergence from the service managers already use to inspect and recover their projects.
