import io
import threading

try:
    from zstandard import ZstdCompressor  # type: ignore[import]

    HAVE_ZSTD = True
except ImportError:
    HAVE_ZSTD = False

from langsmith import utils as ls_utils

compression_level = ls_utils.get_env_var("RUN_COMPRESSION_LEVEL", 3)


class CompressedRuns:
    def __init__(self):
        self.buffer = io.BytesIO()
        self.run_count = 0
        self.lock = threading.Lock()
        self.uncompressed_size = 0

        if not HAVE_ZSTD:
            raise ImportError(
                "zstandard package required for compression. "
                "Install with 'pip install langsmith[compression]'"
            )
        self.compressor_writer = ZstdCompressor(
            level=compression_level, threads=-1
        ).stream_writer(self.buffer, closefd=False)

    def reset(self):
        self.buffer = io.BytesIO()
        self.run_count = 0
        self.uncompressed_size = 0

        if not HAVE_ZSTD:
            raise ImportError(
                "zstandard package required for compression. "
                "Install with 'pip install langsmith[compression]'"
            )
        self.compressor_writer = ZstdCompressor(
            level=compression_level, threads=-1
        ).stream_writer(self.buffer, closefd=False)
