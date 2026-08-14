Inventory complete. Raw checkpoints: [findings-checkpoint.md](C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\11fdfac9-c43f-46cc-bda2-977339b37234\scratchpad\media-work\findings-checkpoint.md).

| Directory | Disk size | Files | Tracked / untracked | Content class |
|---|---:|---:|---:|---|
| `visual-kit/_staging` | 3.06 GB | 891 | 0 / 891 | PNG scene/figure renders; active staging plus archives/rejections |
| `bricks-fresh/assets` | 1.95 GB | 452 | 4 / 448 | Scenes, archives, preview MP4, audio |
| `_bricks-vpw2-slice/scratchpad` | 805 MB | 264 | 0 / 264 | Rejected/test scene renders |
| `render-builder/engine/node_modules` | 602 MB | 9,713 | 0 / 9,713 | Dependency cache, not media |
| `_bricks-seg/assets` | 337 MB | 293 | 0 / 293 | Scenes, review crops, preview/final MP4s |
| `bricks-fresh/scratchpad` | 265 MB | 708 | 244 / 464 | Boards, crops, retries, backups |
| `visual-kit/refs` | 107 MB | 75 | 75 / 0 | Tracked canonical references |

`channels/` measures 6,563,617 KiB; the three largest video trees are `bricks-fresh` (2,165,087 KiB), `_bricks-vpw2-slice` (908,966 KiB), and `_bricks-seg` (334,372 KiB).

Key finding: the pipeline cannot operate on manifests alone today. Forge directly writes and rereads `_staging` ([forge.py](C:\Users\danie\kb\orgs\faceless-youtube\.claude\skills\image-generation\scripts\forge.py:306)); copies verified frames into video assets ([forge.py](C:\Users\danie\kb\orgs\faceless-youtube\.claude\skills\image-generation\scripts\forge.py:2363)); boards open and inline local scene pixels ([build_board.py](C:\Users\danie\kb\orgs\faceless-youtube\.claude\skills\shot-board\scripts\build_board.py:112)); and the renderer validates local `assets/scenes/<id>.png` against the scene manifest ([render.py](C:\Users\danie\kb\orgs\faceless-youtube\.claude\skills\render-builder\scripts\render.py:212)). A fetch/hydration layer is therefore required at every such boundary.

Lifecycle evidence is clear for old renders: the project specification explicitly moves old scenes, reviews, thumbs, boards, and plans into `assets/_archive-pre-reset`, and old staged figures into `_staging/_archive-pre-reset-*` ([design spec](C:\Users\danie\kb\orgs\faceless-youtube\docs\superpowers\specs\2026-08-04-bricks-doctrine-reset-design.md:134)). In contrast, live `_staging` is an active shared generation/review store. Boards and motion JSON are rebuildable; `vo.mp3`, final/preview MP4s, and verified scene pixels are derived but should be retained as deliverable evidence.

The current scene manifest already carries consumer-critical fields: `shot_id`, local `file`, seed roles, review status, retry state, and lineage. SHA-256 is present in staging review records and often embedded in scene-manifest notes, but object key, byte size, and run ID are not consumed by current scripts. Those are integrity/provenance fields; local-path hydration remains necessary.

Main hazards:

- Explicit “main checkout only” convention for gitignored assets, `_staging`, refs, and `vo.mp3` ([design spec](C:\Users\danie\kb\orgs\faceless-youtube\docs\superpowers\specs\2026-08-04-bricks-doctrine-reset-design.md:134), [verification note](C:\Users\danie\kb\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\adversarial-review-2026-08-04.md:403)).
- Several executable scratch scripts hardcode `C:\Users\danie\kb`, e.g. [6c2_drive.py](C:\Users\danie\kb\orgs\faceless-youtube\channels\the-second-take\videos\2026-07-28-bricks-fresh\scratchpad\6c2_drive.py:17).
- No FYT media symlinks/junctions found.
- No tracked file ≥10 MiB found; `visual-kit/refs` is large but wholly tracked.
- Outside `orgs`, ignored `_private/` contains two additional >100 MB untracked copies: 294 MB durable thin-slice tree and 138 MB bare archive.

--- codex-dispatch card 6a7bd166-e0e00915 | model gpt-5.6-terra | exit 0 | 1434s | ops publish: pushed | log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a7bcbd7-a825b127.jsonl | session 019ff394-51f2-7f00-8b81-a8b283d05fe6 (follow up with --follow-up 019ff394-51f2-7f00-8b81-a8b283d05fe6)
