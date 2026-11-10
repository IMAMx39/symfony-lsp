; Security checks taking an attribute (role): AbstractController::isGranted() /
; denyAccessUnlessGranted(), Security / AuthorizationCheckerInterface::isGranted(),
; Security::isGrantedForUser() (attribute second).
(member_call_expression
  name: (name) @method
  arguments: (arguments) @arguments
  (#any-of? @method "isGranted" "denyAccessUnlessGranted" "isGrantedForUser"))

; Arguments of a PHP attribute. #[IsGranted] is recognized in code: its name is resolved
; against the `use` imports of the file.
(attribute
  [(name) (qualified_name)] @attribute
  parameters: (arguments) @arguments)
