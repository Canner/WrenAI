import dbm


class JsonCache:
    def __init__(self, cache_path: str):
        self.cache_path = f"{cache_path}/json_cache"

    def keys(self) -> list:
        with dbm.open(self.cache_path, "r") as db:
            return list(db.keys())

    def write(self, data: str, id_: str) -> None:
        with dbm.open(self.cache_path, "c") as db:
            db[id_] = data

    def read(self, id_: str) -> str:
        with dbm.open(self.cache_path, "r") as db:
            return db[id_].decode()

    def delete(self, id_: str) -> None:
        with dbm.open(self.cache_path, "r") as db:
            del db[id_]
