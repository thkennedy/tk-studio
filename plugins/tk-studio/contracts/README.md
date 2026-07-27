# contracts/

Single home for the studio's versioned contracts (AD-11, AD-12, AD-19; NFR8):

| Artifact | Story | Status |
| --- | --- | --- |
| `events/` — measurement event taxonomy (one schema per event type, one emitter per type) | ST-1.2 | pending |
| `status-block.schema.json` — headless JSON status block | ST-1.2 | pending |
| `interchange/` — canonical epic/story/task shape (`shape_version: 1`) | ST-3.1 | pending |
| `registry.schema.json` — project registry (`registry/projects.yaml`) | ST-2.3 | pending |
| `job.schema.json` — declarative job model | ST-6.1 | pending |
| `driver-contract.md` — versioned harness driver contract | ST-5.3 | pending |
| `conformance/` — dual-mode conformance suite | ST-5.4 | pending |

Every schema carries its own version; breaking change ⇒ major bump. Nothing in
this tree is advisory — skills validate against these, and the conformance
suite enforces them.
