# Build each release on the previous release's commit

Status: accepted, 18 September 2026

A release is assembled on a temporary branch that starts from the latest full release tag when one exists, or from the default branch head for a first release. tC Admin then makes exactly one commit containing the Scripture Burrito snapshot, creates the tag and Door43 release from that commit, and deletes the temporary branch after the release succeeds.

The result is a release history that is its own line of commits: release N+1 is one commit on top of release N. The default branch keeps its own history and, for non-Scripture-Burrito repositories, its own format. The two lines never merge.

The snapshot is assembled from two Door43 Scripture Burrito archives: the latest full release tag supplies the previously released books, and the default branch supplies the selected new and revised books, every root file, and every administrative ingredient. The release's `metadata.json` starts from the previous release's metadata, adds and updates the selected books, refreshes administrative entries, and lists the released books as its scope.

A released book is never removed by a later release. Releases add books and update selected books.

This is hard to reverse because every release's parent is fixed once tagged, and it is surprising because the release commits do not descend from the default branch. The alternative, branching from the default branch head each time, would put unconverted default-branch history under every release commit and force a full rewrite commit on every release rather than a diff against the previous release.
