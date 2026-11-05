; Expressions naming a template. Literals are extracted in code: a plain string,
; or each string of an array / of a ternary (`['a', 'b']`, `x ? 'a' : 'b'`).
(extends expr: (_) @template)
(include expr: (_) @template)
(embed name: (_) @template)
(import expr: (_) @template)
(from expr: (_) @template)
(use expr: (_) @template)

; {{ include('...') }} / {{ source('...') }}: first positional argument.
(call_expression
  name: (function) @function
  arguments: (arguments
    .
    (_) @template)
  (#any-of? @function "include" "source"))
