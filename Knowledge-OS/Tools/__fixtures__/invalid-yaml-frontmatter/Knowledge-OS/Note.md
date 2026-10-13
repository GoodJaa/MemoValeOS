---
type: readme
status: active
lifecycle: active
broken: {a, b
---
# Broken YAML

An unterminated flow collection — a dropped closing brace, the same class of
typo that produced `what: {{what}}` in the old Finding template before it was
fixed. js-yaml throws on this; the old flat-line parser accepted it silently
(and, separately, `{{what}}` itself parses as valid-but-garbage YAML rather
than throwing at all — that case is a content bug fixed in the template, not
a parser error this fixture can catch).
