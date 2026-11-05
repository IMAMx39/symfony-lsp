; {{ path('name', {...}) }} / {{ url('name', {...}) }}: route name, then parameters.
(call_expression
  name: (function) @function
  arguments: (arguments) @arguments
  (#any-of? @function "path" "url"))
