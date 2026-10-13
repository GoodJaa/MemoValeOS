---
type: finding
status: active
lifecycle: active
created: {{date}}
updated: {{date}}
---

{{title}}

<!--
`evidence` is missing on purpose, and a Finding inserted from this template
will fail `missing-evidence-for-active` until you add it.

That is the design, not an oversight. Finding is the one type whose template
starts `lifecycle: active` — it never waits in draft for promotion — and
Evidence Schema requires `evidence` on anything active. The field cannot be
pre-filled here, because a level written by a template is a claim nobody made.

Add it from what you actually did, per `evidenceActionMap` in
`Schema/schema.json`: read → L1, ran → L2, used → L3, confirmed → L4.

`/mv-note` asks the question and fills the field in, which is why it never
produces this failure. Use it rather than this template where you can.
-->

