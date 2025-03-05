"""
.. include:: ../posts/sql_diff.md

----
"""

from __future__ import annotations

import typing as t
from collections import defaultdict
from dataclasses import dataclass
from heapq import heappop, heappush
from itertools import chain

from sqlglot import Dialect, expressions as exp
from sqlglot.helper import seq_get

if t.TYPE_CHECKING:
    from sqlglot.dialects.dialect import DialectType


@dataclass(frozen=True)
class Insert:
    """Indicates that a new node has been inserted"""

    expression: exp.Expression


@dataclass(frozen=True)
class Remove:
    """Indicates that an existing node has been removed"""

    expression: exp.Expression


@dataclass(frozen=True)
class Move:
    """Indicates that an existing node's position within the tree has changed"""

    source: exp.Expression
    target: exp.Expression


@dataclass(frozen=True)
class Update:
    """Indicates that an existing node has been updated"""

    source: exp.Expression
    target: exp.Expression


@dataclass(frozen=True)
class Keep:
    """Indicates that an existing node hasn't been changed"""

    source: exp.Expression
    target: exp.Expression


if t.TYPE_CHECKING:
    from sqlglot._typing import T

    Edit = t.Union[Insert, Remove, Move, Update, Keep]


def diff(
    source: exp.Expression,
    target: exp.Expression,
    matchings: t.List[t.Tuple[exp.Expression, exp.Expression]] | None = None,
    delta_only: bool = False,
    copy: bool = True,
    **kwargs: t.Any,
) -> t.List[Edit]:
    """
    Returns the list of changes between the source and the target expressions.

    Examples:
        >>> diff(parse_one("a + b"), parse_one("a + c"))
        [
            Remove(expression=(COLUMN this: (IDENTIFIER this: b, quoted: False))),
            Insert(expression=(COLUMN this: (IDENTIFIER this: c, quoted: False))),
            Keep(
                source=(ADD this: ...),
                target=(ADD this: ...)
            ),
            Keep(
                source=(COLUMN this: (IDENTIFIER this: a, quoted: False)),
                target=(COLUMN this: (IDENTIFIER this: a, quoted: False))
            ),
        ]

    Args:
        source: the source expression.
        target: the target expression against which the diff should be calculated.
        matchings: the list of pre-matched node pairs which is used to help the algorithm's
            heuristics produce better results for subtrees that are known by a caller to be matching.
            Note: expression references in this list must refer to the same node objects that are
            referenced in the source / target trees.
        delta_only: excludes all `Keep` nodes from the diff.
        copy: whether to copy the input expressions.
            Note: if this is set to false, the caller must ensure that there are no shared references
            in the two trees, otherwise the diffing algorithm may produce unexpected behavior.
        kwargs: additional arguments to pass to the ChangeDistiller instance.

    Returns:
        the list of Insert, Remove, Move, Update and Keep objects for each node in the source and the
        target expression trees. This list represents a sequence of steps needed to transform the source
        expression tree into the target one.
    """
    matchings = matchings or []
    matching_ids = {id(n) for pair in matchings for n in pair}

    def compute_node_mappings(
        original: exp.Expression, copy: exp.Expression
    ) -> t.Dict[int, exp.Expression]:
        node_mapping = {}
        for old_node, new_node in zip(
            reversed(tuple(original.walk())), reversed(tuple(copy.walk()))
        ):
            # We cache the hash of each new node here to speed up equality comparisons. If the input
            # trees aren't copied, these hashes will be evicted before returning the edit script.
            new_node._hash = hash(new_node)

            old_node_id = id(old_node)
            if old_node_id in matching_ids:
                node_mapping[old_node_id] = new_node

        return node_mapping

    source_copy = source.copy() if copy else source
    target_copy = target.copy() if copy else target

    node_mappings = {
        **compute_node_mappings(source, source_copy),
        **compute_node_mappings(target, target_copy),
    }
    matchings_copy = [(node_mappings[id(s)], node_mappings[id(t)]) for s, t in matchings]

    edit_script = ChangeDistiller(**kwargs).diff(
        source_copy,
        target_copy,
        matchings=matchings_copy,
        delta_only=delta_only,
    )

    if not copy:
        for node in chain(source.walk(), target.walk()):
            node._hash = None

    return edit_script


# The expression types for which Update edits are allowed.
UPDATABLE_EXPRESSION_TYPES = (
    exp.Alias,
    exp.Boolean,
    exp.Column,
    exp.DataType,
    exp.Lambda,
    exp.Literal,
    exp.Table,
    exp.Window,
)

IGNORED_LEAF_EXPRESSION_TYPES = (exp.Identifier,)


class ChangeDistiller:
    """
    The implementation of the Change Distiller algorithm described by Beat Fluri and Martin Pinzger in
    their paper https://ieeexplore.ieee.org/document/4339230, which in turn is based on the algorithm by
    Chawathe et al. described in http://ilpubs.stanford.edu:8090/115/1/1995-46.pdf.
    """

    def __init__(self, f: float = 0.6, t: float = 0.6, dialect: DialectType = None) -> None:
        self.f = f
        self.t = t
        self._sql_generator = Dialect.get_or_raise(dialect).generator()

    def diff(
        self,
        source: exp.Expression,
        target: exp.Expression,
        matchings: t.List[t.Tuple[exp.Expression, exp.Expression]] | None = None,
        delta_only: bool = False,
    ) -> t.List[Edit]:
        matchings = matchings or []
        pre_matched_nodes = {id(s): id(t) for s, t in matchings}
        if len({n for pair in pre_matched_nodes.items() for n in pair}) != 2 * len(matchings):
            raise ValueError("Each node can be referenced at most once in the list of matchings")

        self._source = source
        self._target = target
        self._source_index = {
            id(n): n for n in self._source.bfs() if not isinstance(n, IGNORED_LEAF_EXPRESSION_TYPES)
        }
        self._target_index = {
            id(n): n for n in self._target.bfs() if not isinstance(n, IGNORED_LEAF_EXPRESSION_TYPES)
        }
        self._unmatched_source_nodes = set(self._source_index) - set(pre_matched_nodes)
        self._unmatched_target_nodes = set(self._target_index) - set(pre_matched_nodes.values())
        self._bigram_histo_cache: t.Dict[int, t.DefaultDict[str, int]] = {}

        matching_set = self._compute_matching_set() | set(pre_matched_nodes.items())
        return self._generate_edit_script(dict(matching_set), delta_only)

    def _generate_edit_script(self, matchings: t.Dict[int, int], delta_only: bool) -> t.List[Edit]:
        edit_script: t.List[Edit] = []
        for removed_node_id in self._unmatched_source_nodes:
            edit_script.append(Remove(self._source_index[removed_node_id]))
        for inserted_node_id in self._unmatched_target_nodes:
            edit_script.append(Insert(self._target_index[inserted_node_id]))
        for kept_source_node_id, kept_target_node_id in matchings.items():
            source_node = self._source_index[kept_source_node_id]
            target_node = self._target_index[kept_target_node_id]

            identical_nodes = source_node == target_node

            if not isinstance(source_node, UPDATABLE_EXPRESSION_TYPES) or identical_nodes:
                if identical_nodes:
                    source_parent = source_node.parent
                    target_parent = target_node.parent

                    if (
                        (source_parent and not target_parent)
                        or (not source_parent and target_parent)
                        or (
                            source_parent
                            and target_parent
                            and matchings.get(id(source_parent)) != id(target_parent)
                        )
                    ):
                        edit_script.append(Move(source=source_node, target=target_node))
                else:
                    edit_script.extend(
                        self._generate_move_edits(source_node, target_node, matchings)
                    )

                source_non_expression_leaves = dict(_get_non_expression_leaves(source_node))
                target_non_expression_leaves = dict(_get_non_expression_leaves(target_node))

                if source_non_expression_leaves != target_non_expression_leaves:
                    edit_script.append(Update(source_node, target_node))
                elif not delta_only:
                    edit_script.append(Keep(source_node, target_node))
            else:
                edit_script.append(Update(source_node, target_node))

        return edit_script

    def _generate_move_edits(
        self, source: exp.Expression, target: exp.Expression, matchings: t.Dict[int, int]
    ) -> t.List[Move]:
        source_args = [id(e) for e in _expression_only_args(source)]
        target_args = [id(e) for e in _expression_only_args(target)]

        args_lcs = set(
            _lcs(source_args, target_args, lambda l, r: matchings.get(t.cast(int, l)) == r)
        )

        move_edits = []
        for a in source_args:
            if a not in args_lcs and a not in self._unmatched_source_nodes:
                move_edits.append(
                    Move(source=self._source_index[a], target=self._target_index[matchings[a]])
                )

        return move_edits

    def _compute_matching_set(self) -> t.Set[t.Tuple[int, int]]:
        leaves_matching_set = self._compute_leaf_matching_set()
        matching_set = leaves_matching_set.copy()

        ordered_unmatched_source_nodes = {
            id(n): None for n in self._source.bfs() if id(n) in self._unmatched_source_nodes
        }
        ordered_unmatched_target_nodes = {
            id(n): None for n in self._target.bfs() if id(n) in self._unmatched_target_nodes
        }

        for source_node_id in ordered_unmatched_source_nodes:
            for target_node_id in ordered_unmatched_target_nodes:
                source_node = self._source_index[source_node_id]
                target_node = self._target_index[target_node_id]
                if _is_same_type(source_node, target_node):
                    source_leaf_ids = {id(l) for l in _get_expression_leaves(source_node)}
                    target_leaf_ids = {id(l) for l in _get_expression_leaves(target_node)}

                    max_leaves_num = max(len(source_leaf_ids), len(target_leaf_ids))
                    if max_leaves_num:
                        common_leaves_num = sum(
                            1 if s in source_leaf_ids and t in target_leaf_ids else 0
                            for s, t in leaves_matching_set
                        )
                        leaf_similarity_score = common_leaves_num / max_leaves_num
                    else:
                        leaf_similarity_score = 0.0

                    adjusted_t = (
                        self.t if min(len(source_leaf_ids), len(target_leaf_ids)) > 4 else 0.4
                    )

                    if leaf_similarity_score >= 0.8 or (
                        leaf_similarity_score >= adjusted_t
                        and self._dice_coefficient(source_node, target_node) >= self.f
                    ):
                        matching_set.add((source_node_id, target_node_id))
                        self._unmatched_source_nodes.remove(source_node_id)
                        self._unmatched_target_nodes.remove(target_node_id)
                        ordered_unmatched_target_nodes.pop(target_node_id, None)
                        break

        return matching_set

    def _compute_leaf_matching_set(self) -> t.Set[t.Tuple[int, int]]:
        candidate_matchings: t.List[t.Tuple[float, int, int, exp.Expression, exp.Expression]] = []
        source_expression_leaves = list(_get_expression_leaves(self._source))
        target_expression_leaves = list(_get_expression_leaves(self._target))
        for source_leaf in source_expression_leaves:
            for target_leaf in target_expression_leaves:
                if _is_same_type(source_leaf, target_leaf):
                    similarity_score = self._dice_coefficient(source_leaf, target_leaf)
                    if similarity_score >= self.f:
                        heappush(
                            candidate_matchings,
                            (
                                -similarity_score,
                                -_parent_similarity_score(source_leaf, target_leaf),
                                len(candidate_matchings),
                                source_leaf,
                                target_leaf,
                            ),
                        )

        # Pick best matchings based on the highest score
        matching_set = set()
        while candidate_matchings:
            _, _, _, source_leaf, target_leaf = heappop(candidate_matchings)
            if (
                id(source_leaf) in self._unmatched_source_nodes
                and id(target_leaf) in self._unmatched_target_nodes
            ):
                matching_set.add((id(source_leaf), id(target_leaf)))
                self._unmatched_source_nodes.remove(id(source_leaf))
                self._unmatched_target_nodes.remove(id(target_leaf))

        return matching_set

    def _dice_coefficient(self, source: exp.Expression, target: exp.Expression) -> float:
        source_histo = self._bigram_histo(source)
        target_histo = self._bigram_histo(target)

        total_grams = sum(source_histo.values()) + sum(target_histo.values())
        if not total_grams:
            return 1.0 if source == target else 0.0

        overlap_len = 0
        overlapping_grams = set(source_histo) & set(target_histo)
        for g in overlapping_grams:
            overlap_len += min(source_histo[g], target_histo[g])

        return 2 * overlap_len / total_grams

    def _bigram_histo(self, expression: exp.Expression) -> t.DefaultDict[str, int]:
        if id(expression) in self._bigram_histo_cache:
            return self._bigram_histo_cache[id(expression)]

        expression_str = self._sql_generator.generate(expression)
        count = max(0, len(expression_str) - 1)
        bigram_histo: t.DefaultDict[str, int] = defaultdict(int)
        for i in range(count):
            bigram_histo[expression_str[i : i + 2]] += 1

        self._bigram_histo_cache[id(expression)] = bigram_histo
        return bigram_histo


def _get_expression_leaves(expression: exp.Expression) -> t.Iterator[exp.Expression]:
    has_child_exprs = False

    for node in expression.iter_expressions():
        if not isinstance(node, IGNORED_LEAF_EXPRESSION_TYPES):
            has_child_exprs = True
            yield from _get_expression_leaves(node)

    if not has_child_exprs:
        yield expression


def _get_non_expression_leaves(expression: exp.Expression) -> t.Iterator[t.Tuple[str, t.Any]]:
    for arg, value in expression.args.items():
        if isinstance(value, exp.Expression) or (
            isinstance(value, list) and isinstance(seq_get(value, 0), exp.Expression)
        ):
            continue

        yield (arg, value)


def _is_same_type(source: exp.Expression, target: exp.Expression) -> bool:
    if type(source) is type(target):
        if isinstance(source, exp.Join):
            return source.args.get("side") == target.args.get("side")

        if isinstance(source, exp.Anonymous):
            return source.this == target.this

        return True

    return False


def _parent_similarity_score(
    source: t.Optional[exp.Expression], target: t.Optional[exp.Expression]
) -> int:
    if source is None or target is None or type(source) is not type(target):
        return 0

    return 1 + _parent_similarity_score(source.parent, target.parent)


def _expression_only_args(expression: exp.Expression) -> t.Iterator[exp.Expression]:
    yield from (
        arg
        for arg in expression.iter_expressions()
        if not isinstance(arg, IGNORED_LEAF_EXPRESSION_TYPES)
    )


def _lcs(
    seq_a: t.Sequence[T], seq_b: t.Sequence[T], equal: t.Callable[[T, T], bool]
) -> t.Sequence[t.Optional[T]]:
    """Calculates the longest common subsequence"""

    len_a = len(seq_a)
    len_b = len(seq_b)
    lcs_result = [[None] * (len_b + 1) for i in range(len_a + 1)]

    for i in range(len_a + 1):
        for j in range(len_b + 1):
            if i == 0 or j == 0:
                lcs_result[i][j] = []  # type: ignore
            elif equal(seq_a[i - 1], seq_b[j - 1]):
                lcs_result[i][j] = lcs_result[i - 1][j - 1] + [seq_a[i - 1]]  # type: ignore
            else:
                lcs_result[i][j] = (
                    lcs_result[i - 1][j]
                    if len(lcs_result[i - 1][j]) > len(lcs_result[i][j - 1])  # type: ignore
                    else lcs_result[i][j - 1]
                )

    return lcs_result[len_a][len_b]  # type: ignore
