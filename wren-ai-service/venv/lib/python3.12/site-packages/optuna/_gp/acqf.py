from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
import math
from typing import TYPE_CHECKING

import numpy as np

from optuna._gp.gp import kernel
from optuna._gp.gp import KernelParamsTensor
from optuna._gp.gp import posterior
from optuna._gp.search_space import ScaleType
from optuna._gp.search_space import SearchSpace


if TYPE_CHECKING:
    import torch
else:
    from optuna._imports import _LazyImport

    torch = _LazyImport("torch")


def standard_logei(z: torch.Tensor) -> torch.Tensor:
    # Return E_{x ~ N(0, 1)}[max(0, x+z)]

    # We switch the implementation depending on the value of z to
    # avoid numerical instability.
    small = z < -25

    vals = torch.empty_like(z)
    # Eq. (9) in ref: https://arxiv.org/pdf/2310.20708.pdf
    # NOTE: We do not use the third condition because ours is good enough.
    z_small = z[small]
    z_normal = z[~small]
    sqrt_2pi = math.sqrt(2 * math.pi)
    # First condition
    cdf = 0.5 * torch.special.erfc(-z_normal * math.sqrt(0.5))
    pdf = torch.exp(-0.5 * z_normal**2) * (1 / sqrt_2pi)
    vals[~small] = torch.log(z_normal * cdf + pdf)
    # Second condition
    r = math.sqrt(0.5 * math.pi) * torch.special.erfcx(-z_small * math.sqrt(0.5))
    vals[small] = -0.5 * z_small**2 + torch.log((z_small * r + 1) * (1 / sqrt_2pi))
    return vals


def logei(mean: torch.Tensor, var: torch.Tensor, f0: float) -> torch.Tensor:
    # Return E_{y ~ N(mean, var)}[max(0, y-f0)]
    sigma = torch.sqrt(var)
    st_val = standard_logei((mean - f0) / sigma)
    val = torch.log(sigma) + st_val
    return val


def ucb(mean: torch.Tensor, var: torch.Tensor, beta: float) -> torch.Tensor:
    return mean + torch.sqrt(beta * var)


def lcb(mean: torch.Tensor, var: torch.Tensor, beta: float) -> torch.Tensor:
    return mean - torch.sqrt(beta * var)


# TODO(contramundum53): consider abstraction for acquisition functions.
# NOTE: Acquisition function is not class on purpose to integrate numba in the future.
class AcquisitionFunctionType(IntEnum):
    LOG_EI = 0
    UCB = 1
    LCB = 2


@dataclass(frozen=True)
class AcquisitionFunctionParams:
    acqf_type: AcquisitionFunctionType
    kernel_params: KernelParamsTensor
    X: np.ndarray
    search_space: SearchSpace
    cov_Y_Y_inv: np.ndarray
    cov_Y_Y_inv_Y: np.ndarray
    max_Y: float
    beta: float | None
    acqf_stabilizing_noise: float


def create_acqf_params(
    acqf_type: AcquisitionFunctionType,
    kernel_params: KernelParamsTensor,
    search_space: SearchSpace,
    X: np.ndarray,
    Y: np.ndarray,
    beta: float | None = None,
    acqf_stabilizing_noise: float = 1e-12,
) -> AcquisitionFunctionParams:
    X_tensor = torch.from_numpy(X)
    is_categorical = torch.from_numpy(search_space.scale_types == ScaleType.CATEGORICAL)
    with torch.no_grad():
        cov_Y_Y = kernel(is_categorical, kernel_params, X_tensor, X_tensor).detach().numpy()

    cov_Y_Y[np.diag_indices(X.shape[0])] += kernel_params.noise_var.item()
    cov_Y_Y_inv = np.linalg.inv(cov_Y_Y)

    return AcquisitionFunctionParams(
        acqf_type=acqf_type,
        kernel_params=kernel_params,
        X=X,
        search_space=search_space,
        cov_Y_Y_inv=cov_Y_Y_inv,
        cov_Y_Y_inv_Y=cov_Y_Y_inv @ Y,
        max_Y=np.max(Y),
        beta=beta,
        acqf_stabilizing_noise=acqf_stabilizing_noise,
    )


def eval_acqf(acqf_params: AcquisitionFunctionParams, x: torch.Tensor) -> torch.Tensor:
    mean, var = posterior(
        acqf_params.kernel_params,
        torch.from_numpy(acqf_params.X),
        torch.from_numpy(acqf_params.search_space.scale_types == ScaleType.CATEGORICAL),
        torch.from_numpy(acqf_params.cov_Y_Y_inv),
        torch.from_numpy(acqf_params.cov_Y_Y_inv_Y),
        x,
    )

    if acqf_params.acqf_type == AcquisitionFunctionType.LOG_EI:
        return logei(mean=mean, var=var + acqf_params.acqf_stabilizing_noise, f0=acqf_params.max_Y)
    elif acqf_params.acqf_type == AcquisitionFunctionType.UCB:
        assert acqf_params.beta is not None, "beta must be given to UCB."
        return ucb(mean=mean, var=var, beta=acqf_params.beta)
    elif acqf_params.acqf_type == AcquisitionFunctionType.LCB:
        assert acqf_params.beta is not None, "beta must be given to LCB."
        return lcb(mean=mean, var=var, beta=acqf_params.beta)
    else:
        assert False, "Unknown acquisition function type."


def eval_acqf_no_grad(acqf_params: AcquisitionFunctionParams, x: np.ndarray) -> np.ndarray:
    with torch.no_grad():
        return eval_acqf(acqf_params, torch.from_numpy(x)).detach().numpy()


def eval_acqf_with_grad(
    acqf_params: AcquisitionFunctionParams, x: np.ndarray
) -> tuple[float, np.ndarray]:
    assert x.ndim == 1
    x_tensor = torch.from_numpy(x)
    x_tensor.requires_grad_(True)
    val = eval_acqf(acqf_params, x_tensor)
    val.backward()  # type: ignore
    return val.item(), x_tensor.grad.detach().numpy()  # type: ignore
