import asyncio
import os

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase

from eval.metrics.spider.process_sql import Schema, get_schema, get_sql

# Flag to disable value evaluation
DISABLE_VALUE = True
# Flag to disable distinct in select evaluation
DISABLE_DISTINCT = True

TABLE_TYPE = {
    "sql": "sql",
    "table_unit": "table_unit",
}


WHERE_OPS = (
    "not",
    "between",
    "=",
    ">",
    "<",
    ">=",
    "<=",
    "!=",
    "in",
    "like",
    "is",
    "exists",
)


def get_scores(count, pred_total, label_total):
    if pred_total != label_total:
        return 0, 0, 0
    elif count == pred_total:
        return 1, 1, 1
    return 0, 0, 0


def eval_sel(pred, label):
    pred_sel = pred["select"][1]
    label_sel = label["select"][1]
    label_wo_agg = [unit[1] for unit in label_sel]
    pred_total = len(pred_sel)
    label_total = len(label_sel)
    cnt = 0
    cnt_wo_agg = 0

    for unit in pred_sel:
        if unit in label_sel:
            cnt += 1
            label_sel.remove(unit)
        if unit[1] in label_wo_agg:
            cnt_wo_agg += 1
            label_wo_agg.remove(unit[1])

    return label_total, pred_total, cnt, cnt_wo_agg


def eval_where(pred, label):
    pred_conds = [unit for unit in pred["where"][::2]]
    label_conds = [unit for unit in label["where"][::2]]
    label_wo_agg = [unit[2] for unit in label_conds]
    pred_total = len(pred_conds)
    label_total = len(label_conds)
    cnt = 0
    cnt_wo_agg = 0

    for unit in pred_conds:
        if unit in label_conds:
            cnt += 1
            label_conds.remove(unit)
        if unit[2] in label_wo_agg:
            cnt_wo_agg += 1
            label_wo_agg.remove(unit[2])

    return label_total, pred_total, cnt, cnt_wo_agg


def eval_group(pred, label):
    pred_cols = [unit[1] for unit in pred["groupBy"]]
    label_cols = [unit[1] for unit in label["groupBy"]]
    pred_total = len(pred_cols)
    label_total = len(label_cols)
    cnt = 0
    pred_cols = [pred.split(".")[1] if "." in pred else pred for pred in pred_cols]
    label_cols = [
        label.split(".")[1] if "." in label else label for label in label_cols
    ]
    for col in pred_cols:
        if col in label_cols:
            cnt += 1
            label_cols.remove(col)
    return label_total, pred_total, cnt


def eval_having(pred, label):
    pred_total = label_total = cnt = 0
    if len(pred["groupBy"]) > 0:
        pred_total = 1
    if len(label["groupBy"]) > 0:
        label_total = 1

    pred_cols = [unit[1] for unit in pred["groupBy"]]
    label_cols = [unit[1] for unit in label["groupBy"]]
    if (
        pred_total == label_total == 1
        and pred_cols == label_cols
        and pred["having"] == label["having"]
    ):
        cnt = 1

    return label_total, pred_total, cnt


def eval_order(pred, label):
    pred_total = label_total = cnt = 0
    if len(pred["orderBy"]) > 0:
        pred_total = 1
    if len(label["orderBy"]) > 0:
        label_total = 1
    if (
        len(label["orderBy"]) > 0
        and pred["orderBy"] == label["orderBy"]
        and (
            (pred["limit"] is None and label["limit"] is None)
            or (pred["limit"] is not None and label["limit"] is not None)
        )
    ):
        cnt = 1
    return label_total, pred_total, cnt


def eval_and_or(pred, label):
    pred_ao = pred["where"][1::2]
    label_ao = label["where"][1::2]
    pred_ao = set(pred_ao)
    label_ao = set(label_ao)

    if pred_ao == label_ao:
        return 1, 1, 1
    return len(pred_ao), len(label_ao), 0


def get_nestedSQL(sql):
    nested = []
    for cond_unit in sql["from"]["conds"][::2] + sql["where"][::2] + sql["having"][::2]:
        if type(cond_unit[3]) is dict:
            nested.append(cond_unit[3])
        if type(cond_unit[4]) is dict:
            nested.append(cond_unit[4])
    if sql["intersect"] is not None:
        nested.append(sql["intersect"])
    if sql["except"] is not None:
        nested.append(sql["except"])
    if sql["union"] is not None:
        nested.append(sql["union"])
    return nested


def eval_nested(pred, label):
    label_total = 0
    pred_total = 0
    cnt = 0
    if pred is not None:
        pred_total += 1
    if label is not None:
        label_total += 1
    if pred is not None and label is not None:
        cnt += Evaluator().eval_exact_match(pred, label)
    return label_total, pred_total, cnt


def eval_IUEN(pred, label):
    lt1, pt1, cnt1 = eval_nested(pred["intersect"], label["intersect"])
    lt2, pt2, cnt2 = eval_nested(pred["except"], label["except"])
    lt3, pt3, cnt3 = eval_nested(pred["union"], label["union"])
    label_total = lt1 + lt2 + lt3
    pred_total = pt1 + pt2 + pt3
    cnt = cnt1 + cnt2 + cnt3
    return label_total, pred_total, cnt


def get_keywords(sql):
    res = set()
    if len(sql["where"]) > 0:
        res.add("where")
    if len(sql["groupBy"]) > 0:
        res.add("group")
    if len(sql["having"]) > 0:
        res.add("having")
    if len(sql["orderBy"]) > 0:
        res.add(sql["orderBy"][0])
        res.add("order")
    if sql["limit"] is not None:
        res.add("limit")
    if sql["except"] is not None:
        res.add("except")
    if sql["union"] is not None:
        res.add("union")
    if sql["intersect"] is not None:
        res.add("intersect")

    # or keyword
    ao = sql["from"]["conds"][1::2] + sql["where"][1::2] + sql["having"][1::2]
    if len([token for token in ao if token == "or"]) > 0:
        res.add("or")

    cond_units = sql["from"]["conds"][::2] + sql["where"][::2] + sql["having"][::2]
    # not keyword
    if len([cond_unit for cond_unit in cond_units if cond_unit[0]]) > 0:
        res.add("not")

    # in keyword
    if (
        len(
            [
                cond_unit
                for cond_unit in cond_units
                if cond_unit[1] == WHERE_OPS.index("in")
            ]
        )
        > 0
    ):
        res.add("in")

    # like keyword
    if (
        len(
            [
                cond_unit
                for cond_unit in cond_units
                if cond_unit[1] == WHERE_OPS.index("like")
            ]
        )
        > 0
    ):
        res.add("like")

    return res


def eval_keywords(pred, label):
    pred_keywords = get_keywords(pred)
    label_keywords = get_keywords(label)
    pred_total = len(pred_keywords)
    label_total = len(label_keywords)
    cnt = 0

    for k in pred_keywords:
        if k in label_keywords:
            cnt += 1
    return label_total, pred_total, cnt


class Evaluator:
    def eval_exact_match(self, pred: dict, label: dict):
        partial_scores = self.eval_partial_match(pred, label)

        for key, score in partial_scores.items():
            if score["f1"] != 1:
                return 0

        if len(label["from"]["table_units"]) > 0:
            label_tables = sorted(label["from"]["table_units"])
            pred_tables = sorted(pred["from"]["table_units"])
            return label_tables == pred_tables
        return 1

    def eval_partial_match(self, pred, label):
        res = {}

        label_total, pred_total, cnt, cnt_wo_agg = eval_sel(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["select"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }
        acc, rec, f1 = get_scores(cnt_wo_agg, pred_total, label_total)
        res["select(no AGG)"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt, cnt_wo_agg = eval_where(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["where"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }
        acc, rec, f1 = get_scores(cnt_wo_agg, pred_total, label_total)
        res["where(no OP)"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt = eval_group(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["group(no Having)"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt = eval_having(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["group"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt = eval_order(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["order"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt = eval_and_or(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["and/or"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt = eval_IUEN(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["IUEN"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        label_total, pred_total, cnt = eval_keywords(pred, label)
        acc, rec, f1 = get_scores(cnt, pred_total, label_total)
        res["keywords"] = {
            "acc": acc,
            "rec": rec,
            "f1": f1,
            "label_total": label_total,
            "pred_total": pred_total,
        }

        return res


def rebuild_col_unit_col(valid_col_units, col_unit, kmap):
    if col_unit is None:
        return col_unit

    agg_id, col_id, distinct = col_unit
    if col_id in kmap and col_id in valid_col_units:
        col_id = kmap[col_id]
    if DISABLE_DISTINCT:
        distinct = None
    return agg_id, col_id, distinct


def rebuild_val_unit_col(valid_col_units, val_unit, kmap):
    if val_unit is None:
        return val_unit

    unit_op, col_unit1, col_unit2 = val_unit
    col_unit1 = rebuild_col_unit_col(valid_col_units, col_unit1, kmap)
    col_unit2 = rebuild_col_unit_col(valid_col_units, col_unit2, kmap)
    return unit_op, col_unit1, col_unit2


def rebuild_table_unit_col(valid_col_units, table_unit, kmap):
    if table_unit is None:
        return table_unit

    table_type, col_unit_or_sql = table_unit
    if isinstance(col_unit_or_sql, tuple):
        col_unit_or_sql = rebuild_col_unit_col(valid_col_units, col_unit_or_sql, kmap)
    return table_type, col_unit_or_sql


def rebuild_cond_unit_col(valid_col_units, cond_unit, kmap):
    if cond_unit is None:
        return cond_unit

    not_op, op_id, val_unit, val1, val2 = cond_unit
    val_unit = rebuild_val_unit_col(valid_col_units, val_unit, kmap)
    return not_op, op_id, val_unit, val1, val2


def rebuild_condition_col(valid_col_units, condition, kmap):
    for idx in range(len(condition)):
        if idx % 2 == 0:
            condition[idx] = rebuild_cond_unit_col(
                valid_col_units, condition[idx], kmap
            )
    return condition


def rebuild_select_col(valid_col_units, sel, kmap):
    if sel is None:
        return sel
    distinct, _list = sel
    new_list = []
    for it in _list:
        agg_id, val_unit = it
        new_list.append((agg_id, rebuild_val_unit_col(valid_col_units, val_unit, kmap)))
    if DISABLE_DISTINCT:
        distinct = None
    return distinct, new_list


def rebuild_from_col(valid_col_units, from_, kmap):
    if from_ is None:
        return from_

    from_["table_units"] = [
        rebuild_table_unit_col(valid_col_units, table_unit, kmap)
        for table_unit in from_["table_units"]
    ]
    from_["conds"] = rebuild_condition_col(valid_col_units, from_["conds"], kmap)
    return from_


def rebuild_group_by_col(valid_col_units, group_by, kmap):
    if group_by is None:
        return group_by

    return [
        rebuild_col_unit_col(valid_col_units, col_unit, kmap) for col_unit in group_by
    ]


def rebuild_order_by_col(valid_col_units, order_by, kmap):
    if order_by is None or len(order_by) == 0:
        return order_by

    direction, val_units = order_by
    new_val_units = [
        rebuild_val_unit_col(valid_col_units, val_unit, kmap) for val_unit in val_units
    ]
    return direction, new_val_units


def rebuild_sql_col(valid_col_units, sql, kmap):
    if sql is None:
        return sql

    sql["select"] = rebuild_select_col(valid_col_units, sql["select"], kmap)
    sql["from"] = rebuild_from_col(valid_col_units, sql["from"], kmap)
    sql["where"] = rebuild_condition_col(valid_col_units, sql["where"], kmap)
    sql["groupBy"] = rebuild_group_by_col(valid_col_units, sql["groupBy"], kmap)
    sql["orderBy"] = rebuild_order_by_col(valid_col_units, sql["orderBy"], kmap)
    sql["having"] = rebuild_condition_col(valid_col_units, sql["having"], kmap)
    sql["intersect"] = rebuild_sql_col(valid_col_units, sql["intersect"], kmap)
    sql["except"] = rebuild_sql_col(valid_col_units, sql["except"], kmap)
    sql["union"] = rebuild_sql_col(valid_col_units, sql["union"], kmap)

    return sql


# Rebuild SQL functions for value evaluation
def rebuild_cond_unit_val(cond_unit):
    if cond_unit is None or not DISABLE_VALUE:
        return cond_unit

    not_op, op_id, val_unit, val1, val2 = cond_unit
    if type(val1) is not dict:
        val1 = None
    else:
        val1 = rebuild_sql_val(val1)
    if type(val2) is not dict:
        val2 = None
    else:
        val2 = rebuild_sql_val(val2)
    return not_op, op_id, val_unit, val1, val2


def rebuild_condition_val(condition):
    if condition is None or not DISABLE_VALUE:
        return condition

    res = []
    for idx, it in enumerate(condition):
        if idx % 2 == 0:
            res.append(rebuild_cond_unit_val(it))
        else:
            res.append(it)
    return res


def rebuild_sql_val(sql):
    if sql is None or not DISABLE_VALUE:
        return sql

    sql["from"]["conds"] = rebuild_condition_val(sql["from"]["conds"])
    sql["having"] = rebuild_condition_val(sql["having"])
    sql["where"] = rebuild_condition_val(sql["where"])
    sql["intersect"] = rebuild_sql_val(sql["intersect"])
    sql["except"] = rebuild_sql_val(sql["except"])
    sql["union"] = rebuild_sql_val(sql["union"])

    return sql


# Rebuild SQL functions for foreign key evaluation
def build_valid_col_units(table_units, schema):
    col_ids = [
        table_unit[1]
        for table_unit in table_units
        if table_unit[0] == TABLE_TYPE["table_unit"]
    ]
    prefixs = [col_id[:-2] for col_id in col_ids]
    valid_col_units = []
    for value in schema.idMap.values():
        if "." in value and value[: value.index(".")] in prefixs:
            valid_col_units.append(value)
    return valid_col_units


def tokenize(sql: str, schema: dict, kmap: dict) -> dict:
    try:
        struct = get_sql(schema, sql)
    except:
        struct = {
            "except": None,
            "from": {"conds": [], "table_units": []},
            "groupBy": [],
            "having": [],
            "intersect": None,
            "limit": None,
            "orderBy": [],
            "select": [False, []],
            "union": None,
            "where": [],
        }

    g_valid_col_units = build_valid_col_units(struct["from"]["table_units"], schema)
    struct = rebuild_sql_val(struct)
    struct = rebuild_sql_col(g_valid_col_units, struct, kmap)
    return struct


def build_foreign_key_map(entry):
    cols_orig = entry["column_names_original"]
    tables_orig = entry["table_names_original"]

    # rebuild cols corresponding to idmap in Schema
    cols = []
    for col_orig in cols_orig:
        if col_orig[0] >= 0:
            t = tables_orig[col_orig[0]]
            c = col_orig[1]
            cols.append("__" + t.lower() + "." + c.lower() + "__")
        else:
            cols.append("__all__")

    def keyset_in_list(k1, k2, k_list):
        for k_set in k_list:
            if k1 in k_set or k2 in k_set:
                return k_set
        new_k_set = set()
        k_list.append(new_k_set)
        return new_k_set

    foreign_key_list = []
    foreign_keys = entry["foreign_keys"]
    for fkey in foreign_keys:
        key1, key2 = fkey
        key_set = keyset_in_list(key1, key2, foreign_key_list)
        key_set.add(key1)
        key_set.add(key2)

    foreign_key_map = {}
    for key_set in foreign_key_list:
        sorted_list = sorted(list(key_set))
        midx = sorted_list[0]
        for idx in sorted_list:
            foreign_key_map[cols[idx]] = cols[midx]

    return foreign_key_map


def build_foreign_key_map_from_json(table):
    import json

    with open(table) as f:
        data = json.load(f)
    tables = {}
    for entry in data:
        tables[entry["db_id"]] = build_foreign_key_map(entry)
    return tables


class ExactMatchAccuracy(BaseMetric):
    def __init__(self):
        self.threshold = 0
        self.score = 0
        # todo: change the path
        self.kamps = build_foreign_key_map_from_json(
            "./eval/dataset/spider/tables.json"
        )

        self.db_dir = "./eval/dataset/spider/database"

    def measure(self, test_case: LLMTestCase):
        return asyncio.run(self.a_measure(test_case))

    async def a_measure(self, test_case: LLMTestCase, *args, **kwargs):
        if test_case.additional_metadata["database_name"] is None:
            return 0

        db_name = test_case.additional_metadata["database_name"]
        db = os.path.join(self.db_dir, db_name, db_name + ".sqlite")
        schema = Schema(get_schema(db))
        gold_sql = tokenize(test_case.expected_output, schema, self.kamps[db_name])
        pred_sql = tokenize(test_case.actual_output, schema, self.kamps[db_name])

        evaluator = Evaluator()
        self.score = evaluator.eval_exact_match(pred_sql, gold_sql)
        self.success = self.score >= self.threshold

        return self.score

    def is_successful(self):
        return self.success

    @property
    def __name__(self):
        return "ExactMatchAccuracy"


if __name__ == "__main__":
    metric = ExactMatchAccuracy()
    test_case = LLMTestCase(
        input="show me the airlines",
        expected_output="select * from airlines",
        actual_output="select * from airlines",
        additional_metadata={"database_name": "flight_2"},
    )
    print(metric.measure(test_case))
