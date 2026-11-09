; Event names other than class names (those come from php-message-classes.scm).

; `Foo::CONSTANT` (`::class` is filtered out in code).
(class_constant_access_expression
  . [(name) (qualified_name) (relative_scope)] @scope
  . (name) @constant) @access

; `->dispatch($event, 'name')`.
(member_call_expression
  name: (name) @dispatch
  arguments: (arguments) @dispatch_arguments
  (#eq? @dispatch "dispatch"))

; `#[AsEventListener('name')]`: the attribute name is resolved in code.
(attribute
  . [(name) (qualified_name)] @attribute
  parameters: (arguments) @attribute_arguments)

; Keys of the array returned by getSubscribedEvents().
(method_declaration
  name: (name) @subscribed
  body: (compound_statement
    (return_statement
      (array_creation_expression
        (array_element_initializer . (_) @key . (_)))))
  (#eq? @subscribed "getSubscribedEvents"))
