; Template name passed as the first positional argument of the
; AbstractController / Twig\Environment rendering methods.
(member_call_expression
  name: (name) @method
  arguments: (arguments
    .
    (argument
      .
      [(string) (encapsed_string)] @template))
  (#any-of? @method "render" "renderView" "renderBlock" "renderBlockView"))

; #[Template('...')] (short or fully qualified attribute name, filtered in code).
(attribute
  [(name) (qualified_name)] @attribute
  parameters: (arguments
    .
    (argument
      .
      [(string) (encapsed_string)] @template)))
