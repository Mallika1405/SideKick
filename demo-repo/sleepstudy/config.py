from dataclasses import dataclass

@dataclass(frozen=True)
class Config:
    random_seed: int = 42
    test_fraction: float = 0.2
    min_sleep_hours: float = 2.0
    max_sleep_hours: float = 14.0
    outlier_z: float = 3.0
    target: str = "exam_score"

CONFIG = Config()
