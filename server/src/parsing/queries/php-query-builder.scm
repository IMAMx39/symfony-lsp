; QueryBuilder methods taking DQL fragments: their string arguments may hold `alias.field`
; (`from` for its alias argument).
(member_call_expression
  name: (name) @method
  arguments: (arguments) @arguments
  (#any-of? @method
    "select" "addSelect" "from" "where" "andWhere" "orWhere" "having" "andHaving" "orHaving"
    "orderBy" "addOrderBy" "groupBy" "addGroupBy" "join" "innerJoin" "leftJoin" "set" "indexBy")) @call
