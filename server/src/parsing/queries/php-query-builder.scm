; QueryBuilder methods taking DQL fragments: their string arguments may hold `alias.field`.
(member_call_expression
  name: (name) @method
  arguments: (arguments) @arguments
  (#any-of? @method
    "select" "addSelect" "where" "andWhere" "orWhere" "having" "andHaving" "orHaving"
    "orderBy" "addOrderBy" "groupBy" "addGroupBy" "join" "innerJoin" "leftJoin" "set" "indexBy")) @call
