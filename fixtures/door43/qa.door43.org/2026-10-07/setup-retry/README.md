# A first commit, read back and refused, 7 October 2026

Requests on QA with `TEST_TOKEN` (the `tc-admin-qa` account) for `project.create.retry` (#31, E63). Repository `tc-admin-qa/tcadmin-retry-probe-2352`, kept. Every `email` is redacted.

| File | Request | Answer |
| --- | --- | --- |
| `01-POST-user_repos.json` | `POST /user/repos` | 201 |
| `02-GET-repo.json` | `GET /repos/tc-admin-qa/tcadmin-retry-probe-2352` | `empty: true`, `created_at: 2026-10-07T23:52:57Z` |
| `03-POST-contents.json` | `POST …/contents`, one `create` of `README.md` | 201, commit `5d4fe929` |
| `04-GET-repo.json` | the repository again, at once | `empty: false` |
| `05-GET-tree.json` | `GET …/git/trees/master?recursive=true` | `sha: 87f5d127…`, the tree, not the commit |
| `07-GET-tree-by-commit.json` | `GET …/git/trees/5d4fe929…?recursive=true` | the same tree `sha` |
| `08-GET-branch.json` | `GET …/branches/master` | `commit.id: 5d4fe929…`, `commit.timestamp: 2026-10-07T23:52:58Z` |
| `06-POST-contents-again.json` | the same `create` again | 422, "repository file already exists [path: README.md]" |
