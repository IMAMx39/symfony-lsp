; 'key'|trans(parameters, domain, locale, count): only a literal message id.
(filter_expression
  object: (string) @key
  name: (function) @filter
  (#eq? @filter "trans")) @expression
