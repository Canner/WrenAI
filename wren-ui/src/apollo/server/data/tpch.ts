export const sqls = [
  // 1
  `SELECT
  l_returnflag,
  l_linestatus,
  sum(l_quantity) as sum_qty,
  sum(l_extendedprice) as sum_base_price,
  sum(l_extendedprice * (1 - l_discount)) as sum_disc_price,
  sum(l_extendedprice * (1 - l_discount) * (1 + l_tax)) as sum_charge,
  avg(l_quantity) as avg_qty,
  avg(l_extendedprice) as avg_price,
  avg(l_discount) as avg_disc,
  count(*) as count_order
FROM
  lineitem
WHERE
  l_shipdate <= date '1998-12-01' - interval '90' day
GROUP BY
  l_returnflag,
  l_linestatus
ORDER BY
  l_returnflag,
  l_linestatus;`,
  // 2
  `select
	s_acctbal,
	s_name,
	n_name,
	p_partkey,
	p_mfgr,
	s_address,
	s_phone,
	s_comment
from
	part,
	supplier,
	partsupp,
	nation,
	region
where
	p_partkey = ps_partkey
	and s_suppkey = ps_suppkey
	and p_size = 1
	and p_type like '%BRUSHED%'
	and s_nationkey = n_nationkey
	and n_regionkey = r_regionkey
	and r_name = 'name'
	and ps_supplycost = (
		select
			min(ps_supplycost)
		from
			partsupp,
			supplier,
			nation,
			region
		where
			p_partkey = ps_partkey
			and s_suppkey = ps_suppkey
			and s_nationkey = n_nationkey
			and n_regionkey = r_regionkey
			and r_name = ':3'
	)
order by
	s_acctbal desc,
	n_name,
	s_name,
	p_partkey
LIMIT 100;`,
  // 3
  `select
    l_orderkey,
    sum(l_extendedprice * (1 - l_discount)) as revenue,
    o_orderdate,
    o_shippriority
    from
    customer,
    orders,
    lineitem
    where
    c_mktsegment = 'sdf'
    and c_custkey = o_custkey
    and l_orderkey = o_orderkey
    and o_orderdate < date '1991-01-01'
    and l_shipdate > date '2024-01-01'
    group by
    l_orderkey,
    o_orderdate,
    o_shippriority
    order by
    revenue desc,
    o_orderdate
    LIMIT 10;`,
  // 4
  `
    select
      o_orderpriority,
      count(*) as order_count
    from
      orders
    where
      o_orderdate >= date '1991-01-01'
      and o_orderdate < date '1991-01-01' + interval '3' month
      and exists (
        select
          *
        from
          lineitem
        where
          l_orderkey = o_orderkey
          and l_commitdate < l_receiptdate
      )
    group by
      o_orderpriority
    order by
      o_orderpriority
    LIMIT 1;
  `,
  // 5
  `select
      n_name,
      sum(l_extendedprice * (1 - l_discount)) as revenue
    from
      customer,
      orders,
      lineitem,
      supplier,
      nation,
      region
    where
      c_custkey = o_custkey
      and l_orderkey = o_orderkey
      and l_suppkey = s_suppkey
      and c_nationkey = s_nationkey
      and s_nationkey = n_nationkey
      and n_regionkey = r_regionkey
      and r_name = 'ASIA'
      and o_orderdate >= date '1991-01-01'
      and o_orderdate < date '1991-01-01' + interval '1' year
    group by
      n_name
    order by
      revenue desc
    LIMIT 1;`,
  // 6
  `select
    sum(l_extendedprice * l_discount) as revenue
  from
    lineitem
  where
    l_shipdate >= date '1994-01-01'
    and l_shipdate < date '1994-01-01' + interval '1' year
    and l_discount between 1 - 0.01 and 1 + 0.01
    and l_quantity < 0.9
  LIMIT 1;`,
  // 7
  `select
      supp_nation,
      cust_nation,
      l_year,
      sum(volume) as revenue
    from
      (
        select
          n1.n_name as supp_nation,
          n2.n_name as cust_nation,
          extract(year from l_shipdate) as l_year,
          l_extendedprice * (1 - l_discount) as volume
        from
          supplier,
          lineitem,
          orders,
          customer,
          nation n1,
          nation n2
        where
          s_suppkey = l_suppkey
          and o_orderkey = l_orderkey
          and c_custkey = o_custkey
          and s_nationkey = n1.n_nationkey
          and c_nationkey = n2.n_nationkey
          and (
            (n1.n_name = 'ASIA' and n2.n_name = 'US')
            or (n1.n_name = 'US' and n2.n_name = 'ASIA')
          )
          and l_shipdate between date '1995-01-01' and date '1996-12-31'
      ) as shipping
    group by
      supp_nation,
      cust_nation,
      l_year
    order by
      supp_nation,
      cust_nation,
      l_year
    LIMIT 1;`,
  // 8
  `select
	o_year,
	sum(case
		when nation = ':1' then volume
		else 0
	end) / sum(volume) as mkt_share
from
	(
		select
			extract(year from o_orderdate) as o_year,
			l_extendedprice * (1 - l_discount) as volume,
			n2.n_name as nation
		from
			part,
			supplier,
			lineitem,
			orders,
			customer,
			nation n1,
			nation n2,
			region
		where
			p_partkey = l_partkey
			and s_suppkey = l_suppkey
			and l_orderkey = o_orderkey
			and o_custkey = c_custkey
			and c_nationkey = n1.n_nationkey
			and n1.n_regionkey = r_regionkey
			and r_name = 'ASIA'
			and s_nationkey = n2.n_nationkey
			and o_orderdate between date '1995-01-01' and date '1996-12-31'
			and p_type = 'LARGE BRUSHED BRASS'
	) as all_nations
group by
	o_year
order by
	o_year
LIMIT 1;`,
  // 9
  `select
      nation,
      o_year,
      sum(amount) as sum_profit
    from
      (
        select
          n_name as nation,
          extract(year from o_orderdate) as o_year,
          l_extendedprice * (1 - l_discount) - ps_supplycost * l_quantity as amount
        from
          part,
          supplier,
          lineitem,
          partsupp,
          orders,
          nation
        where
          s_suppkey = l_suppkey
          and ps_suppkey = l_suppkey
          and ps_partkey = l_partkey
          and p_partkey = l_partkey
          and o_orderkey = l_orderkey
          and s_nationkey = n_nationkey
          and p_name like '%brown%'
      ) as profit
    group by
      nation,
      o_year
    order by
      nation,
      o_year desc
    LIMIT 1;`,
  // 10
  `select
    c_custkey,
    c_name,
    sum(l_extendedprice * (1 - l_discount)) as revenue,
    c_acctbal,
    n_name,
    c_address,
    c_phone,
    c_comment
  from
    customer,
    orders,
    lineitem,
    nation
  where
    c_custkey = o_custkey
    and l_orderkey = o_orderkey
    and o_orderdate >= date '1993-10-01'
    and o_orderdate < date '1993-10-01' + interval '3' month
    and l_returnflag = 'R'
    and c_nationkey = n_nationkey
  group by
    c_custkey,
    c_name,
    c_acctbal,
    c_phone,
    n_name,
    c_address,
    c_comment
  order by
    revenue desc
  LIMIT 20;`,
  // 19
  `select
	sum(l_extendedprice* (1 - l_discount)) as revenue
from
	lineitem,
	part
where
	(
		p_partkey = l_partkey
		and p_brand = 'Brand#13'
		and p_container in ('SM CASE', 'SM BOX', 'SM PACK', 'SM PKG')
		and l_quantity >= 10 and l_quantity <= 10 + 10
		and p_size between 1 and 5
		and l_shipmode in ('AIR', 'AIR REG')
		and l_shipinstruct = 'DELIVER IN PERSON'
	)
	or
	(
		p_partkey = l_partkey
		and p_brand = 'Brand#23'
		and p_container in ('MED BAG', 'MED BOX', 'MED PKG', 'MED PACK')
		and l_quantity >= 20 and l_quantity <= 20 + 10
		and p_size between 1 and 10
		and l_shipmode in ('AIR', 'AIR REG')
		and l_shipinstruct = 'DELIVER IN PERSON'
	)
	or
	(
		p_partkey = l_partkey
		and p_brand = 'Brand#34'
		and p_container in ('LG CASE', 'LG BOX', 'LG PACK', 'LG PKG')
		and l_quantity >= 30 and l_quantity <= 50 + 10
		and p_size between 1 and 15
		and l_shipmode in ('AIR', 'AIR REG')
		and l_shipinstruct = 'DELIVER IN PERSON'
	)
LIMIT 1;`,
  // 22
  `select
    cntrycode,
    count(*) as numcust,
    sum(c_acctbal) as totacctbal
    from
    (
      select
        substring(c_phone from 1 for 2) as cntrycode,
        c_acctbal
      from
        customer
      where
        substring(c_phone from 1 for 2) in
          ('11-719-748-3364', '30-114-968-4951', '23-791-276-1263', '12-970-682-3487', '28-396-526-5053', '13-806-545-9701', '18-774-241-1462')
        and c_acctbal > (
          select
            avg(c_acctbal)
          from
            customer
          where
            c_acctbal > 0.00
            and substring(c_phone from 1 for 2) in
            ('11-719-748-3364', '30-114-968-4951', '23-791-276-1263', '12-970-682-3487', '28-396-526-5053', '13-806-545-9701', '18-774-241-1462')
        )
        and not exists (
          select
            *
          from
            orders
          where
            o_custkey = c_custkey
        )
    ) as custsale
    group by
    cntrycode
    order by
    cntrycode
    LIMIT 1;`,
  // 18
  `select
      c_name,
      c_custkey,
      o_orderkey,
      o_orderdate,
      o_totalprice,
      sum(l_quantity)
    from
      customer,
      orders,
      lineitem
    where
      o_orderkey in (
        select
          l_orderkey
        from
          lineitem
        group by
          l_orderkey having
            sum(l_quantity) > 20
      )
      and c_custkey = o_custkey
      and o_orderkey = l_orderkey
    group by
      c_name,
      c_custkey,
      o_orderkey,
      o_orderdate,
      o_totalprice
    order by
      o_totalprice desc,
      o_orderdate
    LIMIT 100;`,
];
