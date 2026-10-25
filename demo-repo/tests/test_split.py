import pandas as pd
from sleepstudy.models.split import split_data

def test_split_has_no_overlap():
    n = 50
    df = pd.DataFrame({c: range(n) for c in ['sleep_hours','sleep_debt','study_load','caffeine_level','gpa','stress_index','weekend_gap','exam_score']})
    X_train, X_test, _, _ = split_data(df)
    assert set(X_train.index).isdisjoint(X_test.index)
