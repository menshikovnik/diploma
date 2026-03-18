from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any


class UserStorage:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.users_file = data_dir / "users.json"
        self.ensure_ready()

    def ensure_ready(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        if not self.users_file.exists():
            self.users_file.write_text("[]", encoding="utf-8")
        self._migrate_legacy_records()
        self._purge_legacy_face_images()

    def list_users(self) -> list[dict[str, Any]]:
        return json.loads(self.users_file.read_text(encoding="utf-8"))

    def save_users(self, users: list[dict[str, Any]]) -> None:
        self.users_file.write_text(
            json.dumps(users, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def next_user_id(self) -> int:
        users = self.list_users()
        if not users:
            return 1
        return max(int(user["id"]) for user in users) + 1

    def delete_user(self, user_id: int) -> bool:
        users = self.list_users()
        filtered_users = [user for user in users if int(user["id"]) != user_id]

        if len(filtered_users) == len(users):
            return False

        self.save_users(filtered_users)
        return True

    def _migrate_legacy_records(self) -> None:
        users = self.list_users()
        changed = False

        for user in users:
            if "imagePath" in user:
                user.pop("imagePath", None)
                changed = True

        if changed:
            self.save_users(users)

    def _purge_legacy_face_images(self) -> None:
        legacy_faces_dir = self.data_dir / "faces"
        if legacy_faces_dir.exists():
            shutil.rmtree(legacy_faces_dir, ignore_errors=True)
