; {{ is_granted('ROLE_X') }} / {{ is_granted_for_user(user, 'ROLE_X') }} (SecurityExtension of TwigBridge).
(call_expression
  name: (function) @function
  arguments: (arguments) @arguments
  (#any-of? @function "is_granted" "is_granted_for_user"))
