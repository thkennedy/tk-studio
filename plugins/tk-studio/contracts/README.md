# contracts/

Single home for the studio's versioned contracts (AD-11, AD-12, AD-19; NFR8):

| Artifact | Story | Status |
| --- | --- | --- |
| `events/taxonomy.v1.json` — measurement event taxonomy (one payload schema per event type, one emitter class per type) | ST-1.2 | shipped |
| `status-block.schema.json` — headless JSON status block | ST-1.2 | shipped |
| `interchange/shape.v1.json` — canonical epic/story/task shape (`shape_version: 1`); validated only by `lib/interchange.py` (no adapter ships its own parser) | ST-3.1 | shipped |
| `registry.schema.json` — project registry (`registry/projects.yaml`) | ST-2.3 | shipped |
| `job.schema.json` — declarative job model | ST-6.1 | pending |
| `driver-contract.md` — versioned harness driver contract (v1.0.0, own semver; breaking ⇒ major) | ST-5.3 | shipped |
| `conformance/` — dual-mode conformance suite | ST-5.4 | pending |

Every schema carries its own version; breaking change ⇒ major bump. Nothing in
this tree is advisory — skills validate against these, and the conformance
suite enforces them.
