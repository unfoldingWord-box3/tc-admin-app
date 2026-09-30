# Build each release on the previous release's commit

Status: accepted, 18 September 2026; amended 22 and 30 September 2026 (the 30 September amendment is proposed until the pull request merges)

A release is assembled on a temporary branch that starts from the latest full release tag when one exists, or from the default branch head for a first release. tC Admin then makes exactly one commit containing the Scripture Burrito snapshot, creates the tag and Door43 release from that commit, and deletes the temporary branch after the release succeeds.

The result is a release history that is its own line of commits: release N+1 is one commit on top of release N. The default branch keeps its own history and, for non-Scripture-Burrito repositories, its own format. The two lines never merge.

The snapshot is assembled from two Door43 Scripture Burrito archives: the latest full release tag supplies the previously released books, and the default branch supplies the selected new and revised books, every root file, and every administrative ingredient. The release's `metadata.json` starts from the previous release's metadata, adds and updates the selected books, refreshes administrative entries, and lists the released books as its scope.

A released book is never removed by a later release. Releases add books and update selected books.

Amendment (Q7, Q8): the release's `metadata.json` takes its ingredient entries from the previous release plus the selected books; its `currentScope` lists exactly the released books; its top-level fields (identification, languages, copyright, localized names, type, relationships) come from the default branch's current metadata, where the manager maintains them. Sizes and checksums are recomputed from the files in the snapshot. For a first release everything comes from the default branch.

Amendment (Q22, 30 September 2026): a release is one release, prepared by one or more commits on the temporary branch. Because the branch starts from the previous release tag, carried-forward books are already present and are never uploaded; the commits touch only selected books, refreshed administrative and root files, and `metadata.json`. A first release of a Resource Container repository starts from the default branch and renames the byte-identical book files into `ingredients/` (E18), uploading only `metadata.json`. Selected books are uploaded one at a time from the default-branch archive; when a selection exceeds what one Worker request can carry, they are spread over several commits. The tag and the Door43 release target the final commit. An aligned Bible is 106 MB of files (E30), which Door43 accepts in one request (E31) but a Worker cannot hold, which is why the commit count is no longer fixed at one.

This is hard to reverse because every release's parent is fixed once tagged, and it is surprising because the release commits do not descend from the default branch. The alternative, branching from the default branch head each time, would put unconverted default-branch history under every release commit and force a full rewrite commit on every release rather than a diff against the previous release.
