; Class names a message is reached from: its declaration, `new X()`, `X::class` and type hints.
(class_declaration name: (name) @declared)
(interface_declaration name: (name) @declared)
(object_creation_expression [(name) (qualified_name)] @class)
(class_constant_access_expression
  . [(name) (qualified_name)] @class
  . (name) @constant
  (#eq? @constant "class"))
(named_type [(name) (qualified_name)] @class)
