from __future__ import annotations

from typing import Any
from typing import Callable
from typing import cast
from typing import Sequence
from typing import TYPE_CHECKING
import warnings

import numpy as np

import optuna
from optuna._experimental import experimental_class
from optuna.distributions import BaseDistribution
from optuna.samplers._base import BaseSampler
from optuna.samplers._lazy_random_state import LazyRandomState
from optuna.study import StudyDirection
from optuna.trial import FrozenTrial
from optuna.trial import TrialState


if TYPE_CHECKING:
    import torch

    import optuna._gp.acqf as acqf
    import optuna._gp.gp as gp
    import optuna._gp.optim_mixed as optim_mixed
    import optuna._gp.prior as prior
    import optuna._gp.search_space as gp_search_space
    from optuna.study import Study
else:
    from optuna._imports import _LazyImport

    torch = _LazyImport("torch")
    gp_search_space = _LazyImport("optuna._gp.search_space")
    gp = _LazyImport("optuna._gp.gp")
    optim_mixed = _LazyImport("optuna._gp.optim_mixed")
    acqf = _LazyImport("optuna._gp.acqf")
    prior = _LazyImport("optuna._gp.prior")


@experimental_class("3.6.0")
class GPSampler(BaseSampler):
    """Sampler using Gaussian process-based Bayesian optimization.

    This sampler fits a Gaussian process (GP) to the objective function and optimizes
    the acquisition function to suggest the next parameters.

    The current implementation uses:
        - Matern kernel with nu=2.5 (twice differentiable),
        - Automatic relevance determination (ARD) for the length scale of each parameter,
        - Gamma prior for inverse squared lengthscales, kernel scale, and noise variance,
        - Log Expected Improvement (logEI) as the acquisition function, and
        - Quasi-Monte Carlo (QMC) sampling to optimize the acquisition function.

    .. note::
        This sampler requires ``scipy`` and ``torch``.
        You can install these dependencies with ``pip install scipy torch``.

    Args:
        seed:
            Random seed to initialize internal random number generator.
            Defaults to :obj:`None` (a seed is picked randomly).

        independent_sampler:
            Sampler used for initial sampling (for the first ``n_startup_trials`` trials)
            and for conditional parameters. Defaults to :obj:`None`
            (a random sampler with the same ``seed`` is used).

        n_startup_trials:
            Number of initial trials. Defaults to 10.

        deterministic_objective:
            Whether the objective function is deterministic or not.
            If :obj:`True`, the sampler will fix the noise variance of the surrogate model to
            the minimum value (slightly above 0 to ensure numerical stability).
            Defaults to :obj:`False`.
    """

    def __init__(
        self,
        *,
        seed: int | None = None,
        independent_sampler: BaseSampler | None = None,
        n_startup_trials: int = 10,
        deterministic_objective: bool = False,
    ) -> None:
        self._rng = LazyRandomState(seed)
        self._independent_sampler = independent_sampler or optuna.samplers.RandomSampler(seed=seed)
        self._intersection_search_space = optuna.search_space.IntersectionSearchSpace()
        self._n_startup_trials = n_startup_trials
        self._log_prior: "Callable[[gp.KernelParamsTensor], torch.Tensor]" = (
            prior.default_log_prior
        )
        self._minimum_noise: float = prior.DEFAULT_MINIMUM_NOISE_VAR
        # We cache the kernel parameters for initial values of fitting the next time.
        self._kernel_params_cache: "gp.KernelParamsTensor | None" = None
        self._optimize_n_samples: int = 2048
        self._deterministic = deterministic_objective

    def reseed_rng(self) -> None:
        self._rng.rng.seed()
        self._independent_sampler.reseed_rng()

    def infer_relative_search_space(
        self, study: Study, trial: FrozenTrial
    ) -> dict[str, BaseDistribution]:
        search_space = {}
        for name, distribution in self._intersection_search_space.calculate(study).items():
            if distribution.single():
                continue
            search_space[name] = distribution

        return search_space

    def _optimize_acqf(
        self,
        acqf_params: "acqf.AcquisitionFunctionParams",
        best_params: np.ndarray,
    ) -> np.ndarray:
        # Advanced users can override this method to change the optimization algorithm.
        # However, we do not make any effort to keep backward compatibility between versions.
        # Particularly, we may remove this function in future refactoring.
        normalized_params, _acqf_val = optim_mixed.optimize_acqf_mixed(
            acqf_params,
            warmstart_normalized_params_array=best_params[None, :],
            n_preliminary_samples=2048,
            n_local_search=10,
            tol=1e-4,
            rng=self._rng.rng,
        )
        return normalized_params

    def sample_relative(
        self, study: Study, trial: FrozenTrial, search_space: dict[str, BaseDistribution]
    ) -> dict[str, Any]:
        self._raise_error_if_multi_objective(study)

        if search_space == {}:
            return {}

        states = (TrialState.COMPLETE,)
        trials = study._get_trials(deepcopy=False, states=states, use_cache=True)

        if len(trials) < self._n_startup_trials:
            return {}

        (
            internal_search_space,
            normalized_params,
        ) = gp_search_space.get_search_space_and_normalized_params(trials, search_space)

        _sign = -1.0 if study.direction == StudyDirection.MINIMIZE else 1.0
        score_vals = np.array([_sign * cast(float, trial.value) for trial in trials])

        if np.any(~np.isfinite(score_vals)):
            warnings.warn(
                "GPSampler cannot handle infinite values. "
                "We clamp those values to worst/best finite value."
            )

            finite_score_vals = score_vals[np.isfinite(score_vals)]
            best_finite_score = np.max(finite_score_vals, initial=0.0)
            worst_finite_score = np.min(finite_score_vals, initial=0.0)

            score_vals = np.clip(score_vals, worst_finite_score, best_finite_score)

        standarized_score_vals = (score_vals - score_vals.mean()) / max(1e-10, score_vals.std())

        if self._kernel_params_cache is not None and len(
            self._kernel_params_cache.inverse_squared_lengthscales
        ) != len(internal_search_space.scale_types):
            # Clear cache if the search space changes.
            self._kernel_params_cache = None

        kernel_params = gp.fit_kernel_params(
            X=normalized_params,
            Y=standarized_score_vals,
            is_categorical=(
                internal_search_space.scale_types == gp_search_space.ScaleType.CATEGORICAL
            ),
            log_prior=self._log_prior,
            minimum_noise=self._minimum_noise,
            initial_kernel_params=self._kernel_params_cache,
            deterministic_objective=self._deterministic,
        )
        self._kernel_params_cache = kernel_params

        acqf_params = acqf.create_acqf_params(
            acqf_type=acqf.AcquisitionFunctionType.LOG_EI,
            kernel_params=kernel_params,
            search_space=internal_search_space,
            X=normalized_params,
            Y=standarized_score_vals,
        )

        normalized_param = self._optimize_acqf(
            acqf_params, normalized_params[np.argmax(standarized_score_vals), :]
        )
        return gp_search_space.get_unnormalized_param(search_space, normalized_param)

    def sample_independent(
        self,
        study: Study,
        trial: FrozenTrial,
        param_name: str,
        param_distribution: BaseDistribution,
    ) -> Any:
        self._raise_error_if_multi_objective(study)
        return self._independent_sampler.sample_independent(
            study, trial, param_name, param_distribution
        )

    def before_trial(self, study: Study, trial: FrozenTrial) -> None:
        self._independent_sampler.before_trial(study, trial)

    def after_trial(
        self,
        study: Study,
        trial: FrozenTrial,
        state: TrialState,
        values: Sequence[float] | None,
    ) -> None:
        self._independent_sampler.after_trial(study, trial, state, values)
