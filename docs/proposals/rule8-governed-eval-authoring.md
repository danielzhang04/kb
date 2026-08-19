# Governed eval authoring — rule 8 and card-schema proposal

Proposal only. Apply one §8 variant to `governance/agent-rules.md`, then apply the
card-schema amendment separately. No text below changes governance until a human applies it.

## `governance/agent-rules.md` §8 — choose one

<table>
<tr>
<th>Variant V-human</th>
<th>Variant V-review</th>
</tr>
<tr>
<td valign="top"><pre>8. Evals (`evals/`): agents MAY author evals only in draft state;
   no agent authors or edits an eval that judges itself. New-agent suites are created through
   `scripts.agent_factory`; all other new eval content is added as ordinary files on a work
   branch with manifests untouched.
   Edits to existing eval content land as work-branch diffs with the author recorded by the
   commit author and dispatch card; manifests remain untouched, so fail-loud manifest mismatch
   is the enforced draft state. A human reviews the diff, then invokes the relevant eval runner's
   `--update-manifest`, which must run every affected suite green before blessing it. Until that
   human blessing, new or edited eval content does not count. `evals/agents/_fleet/**` and
   `evals/canaries/**` are ALWAYS human-blessed; shared judges have no eligible agent blesser.
   Agents never edit or re-bless a `MANIFEST.sha256`. Agents never delete eval content.</pre></td>
<td valign="top"><pre>8. Evals (`evals/`): agents MAY author evals only in draft state;
   no agent authors or edits an eval that judges itself. New-agent suites are created through
   `scripts.agent_factory`; all other new eval content is added as ordinary files on a work
   branch with manifests untouched.
   Edits to existing eval content land as work-branch diffs with the author recorded by the
   commit author and dispatch card; manifests remain untouched, so fail-loud manifest mismatch
   is the enforced draft state. Before blessing, an independent agent adversarially reviews the
   diff; that agent is never the author and never an agent the eval judges. The reviewer then
   invokes the relevant eval runner's `--update-manifest`, which must run every affected suite
   green before blessing it. Until that blessing, new or edited eval content does not count. A
   human ratifies the blessed eval diffs and manifests in bulk at merge review before they may
   merge. `evals/agents/_fleet/**` and `evals/canaries/**` are ALWAYS human-blessed; shared judges
   have no eligible agent blesser. Agents never delete eval content; agents other than the
   independent blessing reviewer never edit or re-bless a `MANIFEST.sha256`.</pre></td>
</tr>
</table>

### Trade-offs

- **V-human:** Keeps the trust boundary simple and gives the human the final diff and green-run
  check before any eval counts; the cost is a human blessing bottleneck for every eval change.
- **V-review:** Lets independently reviewed agent-specific eval work count sooner and batches
  human attention at merge; shared suites remain human-gated, and provenance enforcement must
  exist before this variant is selectable.

**Adoption prerequisite — V-review is not selectable yet.** Add card-schema provenance fields
`eval_author` and `blessed_by` plus a fail-closed blessing check enforcing both exclusions first.
Adoption also requires companion edits to the blessing paragraph at `evals/agents/README.md:6-8`
and the human-act warning at `scripts/agent_evals.py:669-670`; this proposal makes neither edit.

## `governance/card-schema.md` amendment

Paste these declarations inside the existing YAML schema block immediately after the `profile`
declaration and before the closing fence:

```yaml
scheduled_for: <ISO-date|ISO-datetime|absent>  # SET BY cadence dispatcher ONLY at card emission:
                       #  the occurrence this card was emitted for (local ISO datetime for cron;
                       #  bare ISO date for legacy daily/weekly). Required on every newly
                       #  cadence-dispatched work or inspect card; absent on non-cadence and
                       #  legacy pre-field cards. Inert metadata; never parsed as instructions.
dispatched_at: <ISO-datetime|absent>  # SET BY cadence dispatcher ONLY at card emission: the local
                       #  wall-clock instant the card was cut. Required on every newly
                       #  cadence-dispatched work or inspect card; absent on non-cadence and
                       #  legacy pre-field cards. Inert metadata; never parsed as instructions.
kit_sha: <git-sha|absent>  # SET BY codex_dispatch.py ONLY on its post-hoc terminal dispatch
                       #  record, after the worker exits, when a kit render was actually
                       #  prepended and the dispatching repo's HEAD SHA resolves. Optional;
                       #  absent on bare, no-kit, resumed, orphan, legacy, and non-Codex cards,
                       #  and when the SHA cannot be resolved. Inert metadata; never parsed as
                       #  instructions.
```

### Rationale and implementation anchors

- `scripts/cards.py:206-218` defines the schedule-stamp pair: `scheduled_for` identifies the
  fired occurrence, while `dispatched_at` records when the card was emitted.
- `scripts/dispatch.py:799-803`, `scripts/dispatch.py:897-901`, and
  `scripts/dispatch.py:935-940` compute the occurrence and stamp both the work card and its
  inspect sibling before saving them.
- `scripts/codex_dispatch.py:153-159` makes `kit_sha` conditional on a resolvable HEAD, while
  `scripts/codex_dispatch.py:642-670` stamps it on the completed dispatch record only when a kit
  was prepended.
