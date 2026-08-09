# contracts/

Single home for the studio's versioned contracts (AD-11, AD-12, AD-19; NFR8):

| Artifact | Story | Status |
| --- | --- | --- |
| `events/taxonomy.v1.json` — measurement event taxonomy (one payload schema per event type, one emitter class per type) | ST-1.2 | shipped |
| `status-block.schema.json` — headless JSON status block | ST-1.2 | shipped |
| `interchange/shape.v1.json` — canonical epic/story/task shape (`shape_version: 1`); validated only by `lib/interchange.py` (no adapter ships its own parser) | ST-3.1 | shipped |
| `registry.schema.json` — project registry (`registry/projects.yaml`) | ST-2.3 | shipped |
| `job.schema.json` — declarative job model (definitions + resumable run state); validated only by `lib/job.py`; shipped generic types in `jobs/`, per-project instances as `.tk-studio/jobs/<id>.json` named by config `jobs[]` scalar refs | ST-6.1 | shipped |
| `driver-contract.md` — versioned harness driver contract (0.1.12, own semver; pre-1.0: the 0.1 line is the pin, breaking ⇒ 0.2.0) | ST-5.3 | shipped |
| `conformance/` — dual-mode conformance suite: `manifest.json` (per-surface drives + preflight postures) + `runner.py` (discovery from skills/, headless drives, `headless-failure` emission) | ST-5.4 | shipped |

Every schema carries its own version; breaking change ⇒ major bump. Nothing in
this tree is advisory — skills validate against these, and the conformance
suite enforces them.
