from scripts.migrate_schema_versions import migrate_card_text, migrate_workflow_text


def test_card_migration_preserves_body_and_is_idempotent():
    source = "---\nid: version-test\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n\n## Work order\nexact body\n"
    migrated = migrate_card_text(source)
    assert migrated.startswith("---\nschema-version: 1\nid: version-test\nproject:")
    assert migrated.endswith("\n## Work order\nexact body\n")
    assert migrate_card_text(migrated) == migrated


def test_workflow_migration_inserts_inside_frontmatter():
    source = "---\nid: demo\nproject: kb-ops\ntitle: Demo\nprofile: research\nstages: []\n---\n\n# Demo\n"
    migrated = migrate_workflow_text(source)
    assert migrated.startswith("---\nschemaVersion: 1\nid: demo")
    assert migrate_workflow_text(migrated) == migrated
