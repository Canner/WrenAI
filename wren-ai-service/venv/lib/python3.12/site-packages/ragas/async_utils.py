"""Async utils."""

import asyncio
from typing import Any, Coroutine, List, Optional

from tqdm.auto import tqdm

from ragas.executor import is_event_loop_running
from ragas.utils import batched


def run_async_tasks(
    tasks: List[Coroutine],
    batch_size: Optional[int] = None,
    show_progress: bool = True,
    progress_bar_desc: str = "Running async tasks",
) -> List[Any]:
    """
    Execute async tasks with optional batching and progress tracking.

    NOTE: Order of results is not guaranteed!

    Args:
        tasks: List of coroutines to execute
        batch_size: Optional size for batching tasks. If None, runs all concurrently
        show_progress: Whether to display progress bars
    """

    async def _run():
        total_tasks = len(tasks)
        results = []

        # If no batching, run all tasks concurrently with single progress bar
        if not batch_size:
            with tqdm(
                total=total_tasks,
                desc=progress_bar_desc,
                disable=not show_progress,
            ) as pbar:
                for future in asyncio.as_completed(tasks):
                    result = await future
                    results.append(result)
                    pbar.update(1)
            return results

        # With batching, show nested progress bars
        batches = batched(tasks, batch_size)  # generator
        n_batches = (total_tasks + batch_size - 1) // batch_size
        with (
            tqdm(
                total=total_tasks,
                desc=progress_bar_desc,
                disable=not show_progress,
                position=0,
                leave=True,
            ) as overall_pbar,
            tqdm(
                total=batch_size,
                desc=f"Batch 1/{n_batches}",
                disable=not show_progress,
                position=1,
                leave=False,
            ) as batch_pbar,
        ):
            for i, batch in enumerate(batches, 1):
                batch_pbar.reset(total=len(batch))
                batch_pbar.set_description(f"Batch {i}/{n_batches}")
                for future in asyncio.as_completed(batch):
                    result = await future
                    results.append(result)
                    overall_pbar.update(1)
                    batch_pbar.update(1)

        return results

    if is_event_loop_running():
        # an event loop is running so call nested_asyncio to fix this
        try:
            import nest_asyncio
        except ImportError:
            raise ImportError(
                "It seems like your running this in a jupyter-like environment. "
                "Please install nest_asyncio with `pip install nest_asyncio` to make it work."
            )
        else:
            nest_asyncio.apply()

    results = asyncio.run(_run())
    return results
