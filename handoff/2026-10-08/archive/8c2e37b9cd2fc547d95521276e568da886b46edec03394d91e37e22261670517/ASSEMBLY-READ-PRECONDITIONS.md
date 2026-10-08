# Public assembly read prerequisite audit

Frozen source: Stage-A closure-3. Source DB: run04 `profile-04/workspace/workspace.sqlite3`.
This is a read-only prerequisite finding, not an assembly acceptance run.

`EpisodeMediaAssemblyStore.read_version(project_id, episode_id, version_id=...)`
reads an existing persisted `episode_media_assembly` artifact through
`StudioRepository`, validates its content, then computes current checks. The
run04 DB has no such artifact. It has four managed asset versions, zero rights
decisions, and zero probe rows. The r05 video gate can add two probe rows only
to an isolated copy; it does not create an assembly artifact. Thus a public
assembly read cannot be observed from run04 or r05 as currently scoped.

`create_version` would require a real `author_actor_id` and records
`author_actor_type="human"`. QA02 will not invent that actor or create a
human-authored assembly on behalf of someone. A later assembly gate needs an
identified, actually authored version (project ID, episode ID, version ID,
content SHA, author identity, and its own frozen DB/profile receipt), plus
permission to use that version in an isolated read. Pending rights can be
represented in assembly checks, but they do not give a resolver positive case.

The final resolver positive branch remains `NOT_RUN`: these inputs have zero
rights decisions and no authentic `CLEARED` grant. Preserve resolver r01's
path boundary result separately from that unexercised branch.
