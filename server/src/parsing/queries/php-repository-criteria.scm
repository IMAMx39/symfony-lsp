; EntityRepository::findBy(criteria, orderBy), findOneBy(criteria, orderBy), count(criteria):
; the receiver must be recognized as a repository.
(member_call_expression
  object: (_) @object
  name: (name) @method
  arguments: (arguments) @arguments
  (#any-of? @method "findBy" "findOneBy" "count"))
